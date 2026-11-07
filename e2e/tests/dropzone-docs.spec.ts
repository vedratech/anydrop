// verify-upload scenario 9: configurations and code copied from the Dropzone documentation run
// unchanged. The snippets below are the documentation's own (Configuration, Events, "Combine with a
// form"), injected as page script text with `Dropzone` bound to our class, as a migrating user would
// (`import { AnyDrop as Dropzone } from '@vedratech/anydrop-ui'`). Checked against what the mock server received.
import { test, expect } from './support/mock';
import { openDemo } from './support/ui';

test.beforeEach(({}, testInfo) => {
  test.skip(
    /iphone|pixel/.test(testInfo.project.name),
    'config and events are engine independent: desktop projects only (mobile layout is covered by ui.spec.ts)',
  );
});

test('the Dropzone docs programmatic configuration, events and methods work unchanged', async ({
  page,
  mock,
}) => {
  const errors = await openDemo(page, mock);
  const seenHeaders: string[] = [];
  const seenBodies: string[] = [];
  await page.route(`${mock.url}/upload`, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      seenHeaders.push(req.headers()['my-awesome-header'] ?? '');
      seenBodies.push(req.postDataBuffer()?.toString('latin1') ?? '');
    }
    return route.fallback();
  });
  await page.evaluate((url) => {
    (window as unknown as { Dropzone: unknown }).Dropzone = (
      window as unknown as { anydrop: { AnyDrop: unknown } }
    ).anydrop.AnyDrop;
    const host = document.createElement('div');
    host.innerHTML = `<div id="myId" class="dropzone"></div>
      <button id="submit-all" type="button">Submit all files</button>`;
    document.body.appendChild(host);
    (window as unknown as { UPLOAD_URL: string }).UPLOAD_URL = url + '/upload';
  }, mock.url);

  // ---- Copied from the Dropzone documentation (Configuration, Events, Methods). ----
  await page.addScriptTag({
    content: `
    window.log = [];
    var myDropzone = new Dropzone("div#myId", {
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
        var myDropzone = this; // closure
        submitButton.addEventListener("click", function () {
          myDropzone.processQueue(); // Tell Dropzone to process all queued files.
        });
        this.on("addedfile", function (file) { window.log.push("addedfile:" + file.name); });
      }
    });
    myDropzone.on("sending", function (file, xhr, formData) {
      formData.append("userName", "bob");
      window.log.push("sending:" + file.name);
    });
    myDropzone.on("processing", function (file) { window.log.push("processing:" + file.name); });
    myDropzone.on("uploadprogress", function (file, progress) { window.log.push("progress"); });
    myDropzone.on("success", function (file, response) { window.log.push("success:" + file.name); });
    myDropzone.on("error", function (file, message) { window.log.push("error:" + file.name + ":" + message); });
    myDropzone.on("maxfilesexceeded", function (file) { window.log.push("maxfilesexceeded:" + file.name); myDropzone.removeFile(file); });
    myDropzone.on("complete", function (file) { window.log.push("complete:" + file.name); });
    myDropzone.on("queuecomplete", function () { window.log.push("queuecomplete"); });
    // ---- end of the copied snippet ----
    window.myDropzone = myDropzone;
  `,
  });

  await expect(page.locator('#myId .dz-message')).toContainText('Drop files here to upload');
  await page.evaluate(() => {
    const dz = (window as unknown as { myDropzone: { addFile(f: File): void } }).myDropzone;
    dz.addFile(new File(['one'], 'one.txt', { type: 'text/plain' }));
    dz.addFile(new File(['two'], 'two.txt', { type: 'text/plain' }));
    dz.addFile(new File(['x'], 'tool.exe', { type: 'application/x-msdownload' })); // wrong type
    dz.addFile(new File([new Uint8Array(3 * 1024 * 1024)], 'huge.txt', { type: 'text/plain' })); // > 2 MB
    dz.addFile(new File(['three'], 'three.txt', { type: 'text/plain' }));
    dz.addFile(new File(['four'], 'four.txt', { type: 'text/plain' })); // the 4th: maxFiles is 3
  });

  // Rejections carry Dropzone's own messages, and addRemoveLinks adds the remove links.
  const log = () => page.evaluate(() => (window as unknown as { log: string[] }).log);
  await expect
    .poll(async () => (await log()).filter((l) => l.startsWith('addedfile:')).length)
    .toBe(6);
  const l1 = await log();
  expect(l1).toContain("error:tool.exe:You can't upload files of this type.");
  expect(l1).toContain('error:huge.txt:File is too big (3MiB). Max filesize: 2MiB.');
  expect(l1).toContain('maxfilesexceeded:four.txt');
  expect(l1.some((l) => l.startsWith('error:four.txt:'))).toBe(true); // "You can not upload any more files."
  await expect(page.locator('#myId .dz-remove').first()).toBeVisible();

  // autoProcessQueue: false: nothing is sent until the button is pressed.
  await page.waitForTimeout(500);
  expect((await mock.log()).filter((e) => e.path === '/upload').length).toBe(0);
  await page.locator('#submit-all').click();
  // parallelUploads: 2 and autoProcessQueue: false, exactly as in Dropzone: one press sends two
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
  expect(seenBodies.every((b) => b.includes('userName') && b.includes('bob'))).toBe(true);

  // Methods: getAcceptedFiles, getRejectedFiles, removeAllFiles(true).
  const state = await page.evaluate(() => {
    const dz = (
      window as unknown as {
        myDropzone: {
          getAcceptedFiles(): Array<{ name: string; status: string }>;
          getRejectedFiles(): Array<{ name: string }>;
          removeAllFiles(c?: boolean): void;
          files: unknown[];
        };
      }
    ).myDropzone;
    const before = {
      accepted: dz
        .getAcceptedFiles()
        .map((f) => `${f.name}:${f.status}`)
        .sort(),
      rejected: dz
        .getRejectedFiles()
        .map((f) => f.name)
        .sort(),
    };
    dz.removeAllFiles(true);
    return { ...before, after: dz.files.length };
  });
  expect(state.accepted).toEqual(['one.txt:success', 'three.txt:success', 'two.txt:success']);
  expect(state.rejected).toEqual(['huge.txt', 'tool.exe']);
  expect(state.after).toBe(0);
  expect(errors).toEqual([]);
});

test('Dropzone.options.<camelizedId> with a form action and an init() that listens to events', async ({
  page,
  mock,
}) => {
  await openDemo(page, mock);
  await page.evaluate((url) => {
    (window as unknown as { Dropzone: unknown }).Dropzone = (
      window as unknown as { anydrop: { AnyDrop: unknown } }
    ).anydrop.AnyDrop;
    const f = document.createElement('form');
    f.id = 'docs-form';
    f.className = 'dropzone';
    f.action = url + '/upload';
    document.body.appendChild(f);
  }, mock.url);
  // From the documentation: "Dropzone.options.myAwesomeDropzone" (camelized form id) with init().
  await page.addScriptTag({
    content: `
    window.events = [];
    Dropzone.options.docsForm = {
      paramName: "file",
      maxFilesize: 2,
      init: function () {
        this.on("addedfile", function (file) { window.events.push("added:" + file.name); });
        this.on("success", function (file) { window.events.push("success:" + file.name); });
      }
    };
    window.dz = new Dropzone("#docs-form");
  `,
  });
  await page.evaluate(() => {
    (window as unknown as { dz: { addFile(f: File): void } }).dz.addFile(
      new File(['hello'], 'docs.txt', { type: 'text/plain' }),
    );
  });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { events: string[] }).events))
    .toEqual(['added:docs.txt', 'success:docs.txt']);
  expect((await mock.report()).merged.files.map((f) => f.path)).toEqual(['docs.txt']);
});
