// verify-upload scenario 9: the snippets from AnyDrop's own documentation run as written. They are
// injected as page script text (programmatic configuration, events, methods, the `init` hook, and
// `AnyDrop.options.<id>` presets with `.anydrop` auto-discovery), with `AnyDrop` bound to our class,
// and checked against what the mock server received.
import { test, expect } from './support/mock';
import { openDemo } from './support/ui';

test.beforeEach(({}, testInfo) => {
  test.skip(
    /iphone|pixel/.test(testInfo.project.name),
    'config and events are engine independent: desktop projects only (mobile layout is covered by ui.spec.ts)',
  );
});

test('the documented programmatic configuration, events and methods work as written', async ({
  page,
  mock,
  browserName,
}) => {
  const errors = await openDemo(page, mock);
  const seenHeaders: string[] = [];
  const seenBodies: string[] = [];
  // A request body is only readable through a route (the `request` event has no body for Blob parts
  // in Chromium). On WebKit a route over upload traffic is where the sporadic empty chunk body was seen
  // (WEBKIT-FLAKE-1, decision 0019), so there the headers are observed without intercepting and the
  // form field is checked from the page (the `sending` handler below) instead of from the wire.
  const intercept = browserName !== 'webkit';
  if (intercept) {
    await page.route(`${mock.url}/upload`, async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        seenHeaders.push(req.headers()['my-awesome-header'] ?? '');
        seenBodies.push(req.postDataBuffer()?.toString('latin1') ?? '');
      }
      return route.fallback();
    });
  } else {
    page.on('request', (req) => {
      if (req.url() !== `${mock.url}/upload` || req.method() !== 'POST') return;
      seenHeaders.push(req.headers()['my-awesome-header'] ?? '');
    });
  }
  await page.evaluate((url) => {
    (window as unknown as { AnyDrop: unknown }).AnyDrop = (
      window as unknown as { anydrop: { AnyDrop: unknown } }
    ).anydrop.AnyDrop;
    const host = document.createElement('div');
    host.innerHTML = `<div id="myId" class="anydrop"></div>
      <button id="submit-all" type="button">Submit all files</button>`;
    document.body.appendChild(host);
    (window as unknown as { UPLOAD_URL: string }).UPLOAD_URL = url + '/upload';
  }, mock.url);

  // ---- As written in the AnyDrop documentation (Configuration, Events, Methods). ----
  await page.addScriptTag({
    content: `
    window.log = [];
    var myZone = new AnyDrop("div#myId", {
      url: window.UPLOAD_URL,
      paramName: "file", // The name that will be used to transfer the file
      maxFilesize: 2, // MB
      maxFiles: 3,
      acceptedFiles: "image/*,application/pdf,.txt",
      addRemoveLinks: true,
      autoProcessQueue: false,
      parallelUploads: 2,
      headers: { "My-Awesome-Header": "header value" },
      dictDefaultMessage: "Drop files here to upload",
      init: function () {
        var submitButton = document.querySelector("#submit-all");
        var myZone = this; // closure
        submitButton.addEventListener("click", function () {
          myZone.processQueue(); // Tell AnyDrop to process all queued files.
        });
        this.on("addedfile", function (file) { window.log.push("addedfile:" + file.name); });
      }
    });
    myZone.on("sending", function (file, xhr, formData) {
      formData.append("userName", "bob");
      window.sentUserName = (window.sentUserName || 0) + (formData.get("userName") === "bob" ? 1 : 0);
      window.log.push("sending:" + file.name);
    });
    myZone.on("processing", function (file) { window.log.push("processing:" + file.name); });
    myZone.on("uploadprogress", function (file, progress) { window.log.push("progress"); });
    myZone.on("success", function (file, response) { window.log.push("success:" + file.name); });
    myZone.on("error", function (file, message) { window.log.push("error:" + file.name + ":" + message); });
    myZone.on("maxfilesexceeded", function (file) { window.log.push("maxfilesexceeded:" + file.name); myZone.removeFile(file); });
    myZone.on("complete", function (file) { window.log.push("complete:" + file.name); });
    myZone.on("queuecomplete", function () { window.log.push("queuecomplete"); });
    // ---- end of the documented snippet ----
    window.myZone = myZone;
  `,
  });

  await expect(page.locator('#myId .ad-message')).toContainText('Drop files here to upload');
  await page.evaluate(() => {
    const zone = (window as unknown as { myZone: { addFile(f: File): void } }).myZone;
    zone.addFile(new File(['one'], 'one.txt', { type: 'text/plain' }));
    zone.addFile(new File(['two'], 'two.txt', { type: 'text/plain' }));
    zone.addFile(new File(['x'], 'tool.exe', { type: 'application/x-msdownload' })); // wrong type
    zone.addFile(new File([new Uint8Array(3 * 1024 * 1024)], 'huge.txt', { type: 'text/plain' })); // > 2 MB
    zone.addFile(new File(['three'], 'three.txt', { type: 'text/plain' }));
    zone.addFile(new File(['four'], 'four.txt', { type: 'text/plain' })); // the 4th: maxFiles is 3
  });

  // Rejections carry the documented messages, and addRemoveLinks adds the remove links.
  const log = () => page.evaluate(() => (window as unknown as { log: string[] }).log);
  await expect
    .poll(async () => (await log()).filter((l) => l.startsWith('addedfile:')).length)
    .toBe(6);
  const l1 = await log();
  expect(l1).toContain("error:tool.exe:You can't upload files of this type.");
  expect(l1).toContain('error:huge.txt:File is too big (3MiB). Max filesize: 2MiB.');
  expect(l1).toContain('maxfilesexceeded:four.txt');
  expect(l1.some((l) => l.startsWith('error:four.txt:'))).toBe(true); // "You cannot upload any more files."
  await expect(page.locator('#myId .ad-file-remove').first()).toBeVisible();

  // autoProcessQueue: false: nothing is sent until the button is pressed.
  await page.waitForTimeout(500);
  expect((await mock.log()).filter((e) => e.path === '/upload').length).toBe(0);
  await page.locator('#submit-all').click();
  // parallelUploads: 2 and autoProcessQueue: false, as documented: one press sends two
  // files, the third waits for the next press.
  await expect
    .poll(async () => (await log()).filter((l) => l.startsWith('success:')).length)
    .toBe(2);
  await page.waitForTimeout(400);
  expect((await log()).includes('processing:three.txt')).toBe(false);
  await page.locator('#submit-all').click();
  await expect
    .poll(async () => (await log()).includes('queuecomplete'), { timeout: 20_000 })
    .toBe(true);

  const l2 = await log();
  for (const n of ['one.txt', 'two.txt', 'three.txt']) {
    // The documented event order for a file.
    const order = ['processing:', 'sending:', 'success:', 'complete:'].map((p) =>
      l2.indexOf(p + n),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  }
  expect(l2.filter((l) => l.startsWith('sending:')).length).toBe(3);
  expect(l2[l2.length - 1]).toBe('queuecomplete');
  expect(l2).toContain('progress');

  // The server got exactly the accepted files, with the header and the added form field.
  const report = await mock.report();
  expect(report.merged.files.map((f) => f.path).sort()).toEqual([
    'one.txt',
    'three.txt',
    'two.txt',
  ]);
  expect(seenHeaders.length).toBeGreaterThanOrEqual(3);
  expect(seenHeaders.every((h) => h === 'header value')).toBe(true);
  if (intercept) {
    expect(seenBodies.every((b) => b.includes('userName') && b.includes('bob'))).toBe(true);
  }
  // Each sent chunk or file went through `sending`, where the field was added.
  expect(
    await page.evaluate(() => (window as unknown as { sentUserName: number }).sentUserName),
  ).toBeGreaterThanOrEqual(3);

  // Methods: getAcceptedFiles, getRejectedFiles, removeAllFiles(true).
  const state = await page.evaluate(() => {
    const zone = (
      window as unknown as {
        myZone: {
          getAcceptedFiles(): Array<{ name: string; status: string }>;
          getRejectedFiles(): Array<{ name: string }>;
          removeAllFiles(c?: boolean): void;
          files: unknown[];
        };
      }
    ).myZone;
    const before = {
      accepted: zone
        .getAcceptedFiles()
        .map((f) => `${f.name}:${f.status}`)
        .sort(),
      rejected: zone
        .getRejectedFiles()
        .map((f) => f.name)
        .sort(),
    };
    zone.removeAllFiles(true);
    return { ...before, after: zone.files.length };
  });
  expect(state.accepted).toEqual(['one.txt:success', 'three.txt:success', 'two.txt:success']);
  expect(state.rejected).toEqual(['huge.txt', 'tool.exe']);
  expect(state.after).toBe(0);
  expect(errors).toEqual([]);
});

test('AnyDrop.options.<camelizedId> on a .anydrop form with an action and an init() that listens to events', async ({
  page,
  mock,
}) => {
  await openDemo(page, mock);
  await page.evaluate((url) => {
    (window as unknown as { AnyDrop: unknown }).AnyDrop = (
      window as unknown as { anydrop: { AnyDrop: unknown } }
    ).anydrop.AnyDrop;
    const f = document.createElement('form');
    f.id = 'docs-form';
    f.className = 'anydrop';
    f.action = url + '/upload';
    const wrap = document.createElement('div');
    wrap.id = 'docs-root';
    wrap.appendChild(f);
    document.body.appendChild(wrap);
  }, mock.url);
  // From the documentation: "AnyDrop.options.docsForm" (camelized element id) with init().
  await page.addScriptTag({
    content: `
    window.events = [];
    AnyDrop.options.docsForm = {
      paramName: "file",
      maxFilesize: 2,
      init: function () {
        this.on("addedfile", function (file) { window.events.push("added:" + file.name); });
        this.on("success", function (file) { window.events.push("success:" + file.name); });
      }
    };
    // .anydrop auto-discovery (the CDN build runs this by itself on load).
    window.zone = AnyDrop.discover(document.getElementById("docs-root"))[0];
  `,
  });
  await page.evaluate(() => {
    (window as unknown as { zone: { addFile(f: File): void } }).zone.addFile(
      new File(['hello'], 'docs.txt', { type: 'text/plain' }),
    );
  });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { events: string[] }).events))
    .toEqual(['added:docs.txt', 'success:docs.txt']);
  expect((await mock.report()).merged.files.map((f) => f.path)).toEqual(['docs.txt']);
});
