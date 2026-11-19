// all content is fetched at startup, discovered via the manifest.
// This is why the game needs a static server rather than file://.

const jsyaml = window.jsyaml;

// no-cache: revalidate with the server on every load, so an edited file is
// never served stale, while an unchanged one costs only a 304.
async function loadYaml(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  return jsyaml.load(await res.text());
}

// The list of art and audio files (tools/build-art.py writes it). Optional:
// without it the engine probes for each file instead.
async function loadArtIndex() {
  try {
    const res = await fetch('assets/asset-index.json', { cache: 'no-cache' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function loadContent() {
  const [manifest, characters, glossary, maps, endings, artIndex] = await Promise.all([
    loadYaml('content/manifest.yaml'),
    loadYaml('content/characters.yaml'),
    loadYaml('content/glossary.yaml'),
    loadYaml('content/maps.yaml'),
    loadYaml('content/endings.yaml'),
    loadArtIndex(),
  ]);
  const files = manifest.vignettes;
  const loaded = await Promise.all(files.map((f) => loadYaml(`content/vignettes/${f}`)));
  const vignettes = {};
  files.forEach((f, i) => { vignettes[f] = loaded[i]; });
  return {
    manifest, characters, glossary, maps, vignettes, artIndex,
    endings: (endings && endings.endings) || [],
  };
}
