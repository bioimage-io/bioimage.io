/**
 * Build a throwaway colab dataset for tests/annotate-save-reliability.spec.ts.
 *
 * The artifact is left STAGED on purpose: the broker's get_save_urls asserts
 * `artifact.staging is not None`, so a committed fixture cannot exercise the
 * save path at all.
 *
 * Node, not Python, because the JS hypha-rpc client is the one the app uses.
 * It expects a browser, so two DOM globals are shimmed before the import.
 *
 *   node notes/verify/make_fixture.cjs            # create, prints the env line
 *   node notes/verify/make_fixture.cjs --delete bioimage-io/<alias>
 */
globalThis.ImageData = globalThis.ImageData || class ImageData {};
globalThis.ImageBitmap = globalThis.ImageBitmap || class ImageBitmap {};
const fs = require('fs');
const zlib = require('zlib');
const ROOT = '/data/nmechtel/bioimage.io/.dev/worktree/smooth-forest';
const { hyphaWebsocketClient } = require(`${ROOT}/node_modules/hypha-rpc`);

const COLLECTION_ID = 'bioimage-io/colab-annotations';
const LABEL = 'cells';
const STEM = 'verify35_cells';

/** 8-bit greyscale PNG with a few bright discs, so a drawn mask has something under it. */
function makePng(w, h) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0; // filter byte: none
    for (let x = 0; x < w; x++) {
      let v = 18;
      for (const [cx, cy, r] of [[128, 128, 46], [330, 170, 58], [200, 370, 52], [400, 400, 40]]) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < r) v = Math.max(v, Math.round(235 - (d / r) * 70));
      }
      raw[y * (w + 1) + 1 + x] = v;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

async function connect() {
  const token =
    process.env.FIXTURE_HYPHA_TOKEN ||
    fs.readFileSync('/data/nmechtel/bioimage.io/.env', 'utf8').match(/HYPHA_TOKEN=(\S+)/)[1];
  const server = await hyphaWebsocketClient.connectToServer({
    server_url: 'https://hypha.aicell.io',
    token,
  });
  return server;
}

async function getBroker(server) {
  const svcs = await server.listServices('bioimage-io');
  const match = svcs.find((s) => (s.id || '').includes('annotation-broker'));
  if (!match) throw new Error('annotation-broker not found in bioimage-io');
  return server.getService(match.id);
}

(async () => {
  const server = await connect();
  const am = await server.getService('public/artifact-manager');

  if (process.argv[2] === '--delete') {
    const id = process.argv[3];
    if (!id) throw new Error('--delete needs an artifact id');
    await am.delete({ artifact_id: id, delete_files: true, recursive: true, _rkwargs: true });
    let gone = false;
    try {
      await am.read({ artifact_id: id, _rkwargs: true });
    } catch {
      gone = true;
    }
    console.log(`deleted ${id}; absence confirmed = ${gone}`);
    await server.disconnect();
    return;
  }

  // FIXTURE_ALIAS lets a caller own the name, which verify-0035.sh needs:
  // it has to pass the same alias to the spec and to the cleanup, so the
  // builder must not pick one of its own behind the caller's back.
  const alias = process.env.FIXTURE_ALIAS || `verify35-${Math.random().toString(16).slice(2, 14)}`;
  const artifactId = `bioimage-io/${alias}`;
  const uid = server.config.user?.id;
  const email = server.config.user?.email;

  await am.create({
    parent_id: COLLECTION_ID,
    alias,
    // created_by and owner are load-bearing: the broker's register_dataset
    // matches the caller against manifest.created_by / manifest.owner /
    // artifact.created_by, and the artifact's own created_by is the PARENT
    // github account, which never matches the session user id.
    manifest: {
      name: `#0035 verification fixture ${alias}`,
      description: 'Throwaway. Delete after use.',
      created_by: uid,
      owner: { id: uid, email },
    },
    type: 'dataset',
    stage: true,
    config: uid ? { permissions: { [uid]: '*' } } : undefined,
    _rkwargs: true,
  });

  const png = makePng(512, 512);
  const putUrl = await am.put_file({ artifact_id: artifactId, file_path: `images/${STEM}.png`, _rkwargs: true });
  const res = await fetch(putUrl, { method: 'PUT', body: png });
  if (!res.ok) throw new Error(`image PUT failed: HTTP ${res.status}`);

  const broker = await getBroker(server);
  await broker.register_dataset({ artifact_id: artifactId, _rkwargs: true });
  await broker.create_label({ artifact_id: artifactId, name: LABEL, description: 'verification', _rkwargs: true });

  const index = await broker.get_dataset_index({ artifact_id: artifactId, _rkwargs: true });
  console.log('images in index =', (index.images || []).map((i) => i.stem));
  console.log('labels in index =', (index.labels || []).map((l) => l.name));
  console.log('');
  console.log(`FIXTURE_ALIAS=${alias} FIXTURE_LABEL=${LABEL} FIXTURE_STEM=${STEM}`);
  console.log(`delete with: node notes/verify/make_fixture.cjs --delete ${artifactId}`);
  await server.disconnect();
})()
  .then(() => {
    // `disconnect()` resolves but leaves the websocket's handles on the event
    // loop, so node never exits on its own. Measured: five runs of this file
    // sat alive for 40 to 100 minutes AFTER the delete had landed, which made
    // verify-0035.sh hang forever at its cleanup step and would have made the
    // close gate wait on it indefinitely. The work is done by this point, so
    // exit explicitly rather than waiting for a loop that will not drain.
    process.exit(0);
  })
  .catch((e) => {
    console.error('ERR', e.message);
    process.exit(1);
  });
