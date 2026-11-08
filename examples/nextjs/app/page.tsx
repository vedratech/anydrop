import { AnyDrop } from '@vedratech/anydrop-react';
import { Scenario } from './Scenario';

// A Server Component. <AnyDrop> may be rendered here with serialisable props only (a plain `url`,
// plain-data `options`). Handlers, render props and function options need a client component of
// your own, like <Scenario /> below.
export default function Page() {
  return (
    <>
      <section style={{ maxWidth: 860, margin: '16px auto 0', fontFamily: 'system-ui' }}>
        Rendered on the server: a plain uploader with serialisable props.
        <AnyDrop url="/upload" id="server-rendered" />
      </section>
      <Scenario />
    </>
  );
}
