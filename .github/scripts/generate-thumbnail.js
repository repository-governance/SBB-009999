import { appendFile, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EMPTY_VIEW_ERRORS = new Set([
  'Diagram image contains no visible diagram content',
  'Diagram image has invalid or empty dimensions',
  'Generated thumbnail is empty',
]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const VIEW_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
export const VIEW_THUMBNAILS_FILE = 'view-thumbnails.json';

// Empty views are listed with a null thumbnail and no image file.
export async function renderViewThumbnails({ views, createThumbnail, outputDirectory, maxDimension = 1200 }) {
  const thumbnailDirectory = path.join(outputDirectory, 'thumbnails');
  await mkdir(thumbnailDirectory, { recursive: true });
  const rendered = [];
  for (const view of views) {
    if (!VIEW_ID_PATTERN.test(view.reportId)) {
      throw new Error(`La vista ${view.name} tiene un identificador no válido para una miniatura.`);
    }
    const fileName = `${view.reportId}.png`;
    const outputPath = path.join(thumbnailDirectory, fileName);
    try {
      await createThumbnail(view.imagePath, outputPath, { maxDimension });
      rendered.push({ id: view.reportId, name: view.name, thumbnail: `thumbnails/${fileName}` });
    } catch (error) {
      await rm(outputPath, { force: true });
      if (!EMPTY_VIEW_ERRORS.has(error.message)) {
        throw error;
      }
      console.info(`Skipping empty view ${view.reportId}.`);
      rendered.push({ id: view.reportId, name: view.name, thumbnail: null });
    }
  }
  return rendered;
}

async function assertPng(filePath) {
  const image = await readFile(filePath);
  if (image.length < 100 || !image.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${path.basename(filePath)} no es un PNG válido.`);
  }
}

// Applies the rendered view list to the repository checkout, keeping viewpoints governed by the pipeline.
export async function publishViewThumbnails({ repositoryRoot, artifactDirectory }) {
  const rendered = JSON.parse(await readFile(path.join(artifactDirectory, VIEW_THUMBNAILS_FILE), 'utf8'));
  const thumbnailDirectory = path.join(repositoryRoot, 'thumbnails');
  await rm(thumbnailDirectory, { recursive: true, force: true });
  await mkdir(thumbnailDirectory, { recursive: true });
  await writeFile(path.join(thumbnailDirectory, '.gitkeep'), '');
  for (const { thumbnail } of rendered) {
    if (!thumbnail) {
      continue;
    }
    await assertPng(path.join(artifactDirectory, thumbnail));
    await copyFile(path.join(artifactDirectory, thumbnail), path.join(repositoryRoot, thumbnail));
  }

  // The repository card reads the first view thumbnail; remove the root image left by earlier runs.
  await rm(path.join(repositoryRoot, 'thumbnail.png'), { force: true });

  const manifestPath = path.join(repositoryRoot, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const inventory = manifest.inventory ?? {};
  const previousViews = new Map((inventory.viewDetails ?? []).map((view) => [view.id, view]));
  manifest.inventory = {
    ...inventory,
    viewDetails: rendered.map(({ id, name, thumbnail }) => ({
      viewpoint: null,
      ...previousViews.get(id),
      id,
      name,
      thumbnail,
    })),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main() {
  const repositoryRoot = process.cwd();
  if (process.argv[2] === 'publish') {
    await publishViewThumbnails({ repositoryRoot, artifactDirectory: path.resolve(process.argv[3]) });
    return;
  }
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'sbb-archi-'));
  const workspace = path.join(temporaryDirectory, 'workspace');
  const outputDirectory = path.join(temporaryDirectory, 'output');
  const generatorDirectory = path.resolve('.thumbnail-generator');

  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(outputDirectory, { recursive: true }),
  ]);
  await copyFile(path.join(repositoryRoot, 'source/design.archimate'), path.join(workspace, 'design.archimate'));
  if (process.platform === 'linux') {
    await Promise.all([
      chmod(temporaryDirectory, 0o755),
      chmod(workspace, 0o777),
      chmod(outputDirectory, 0o777),
    ]);
  }

  const generatorModule = (name) => pathToFileURL(path.join(generatorDirectory, 'src', name)).href;
  const [{ runArchi }, { extractViews }, { createThumbnail }] = await Promise.all([
    import(generatorModule('archi-processor.js')),
    import(generatorModule('view-extractor.js')),
    import(generatorModule('thumbnail-generator.js')),
  ]);

  await runArchi('design.archimate', workspace, outputDirectory, { timeout: 240_000 });

  const setGeneratedOutput = async (generated) => {
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, `generated=${generated}\n`);
    }
  };

  let views;
  try {
    views = await extractViews(path.join(outputDirectory, 'report'), { maxViews: 100 });
  } catch (error) {
    if (error.message === 'The Archi HTML report contains no diagram views') {
      console.info('No renderable diagram views were found; view thumbnails were left unchanged.');
      await setGeneratedOutput(false);
      return;
    }
    throw error;
  }

  const artifactsDirectory = path.join(repositoryRoot, 'artifacts');
  const rendered = await renderViewThumbnails({ views, createThumbnail, outputDirectory: artifactsDirectory });
  await writeFile(path.join(artifactsDirectory, VIEW_THUMBNAILS_FILE), `${JSON.stringify(rendered, null, 2)}\n`);
  await setGeneratedOutput(true);
  console.info(`Rendered ${rendered.filter(({ thumbnail }) => thumbnail).length} of ${rendered.length} views.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Thumbnail generation failed: ${error.message}`);
    process.exitCode = 1;
  });
}