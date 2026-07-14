import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const target = process.env.VIEWER_URL ?? "http://127.0.0.1:5173/";
const parquetPath =
  process.env.OPENARM_PARQUET ??
  "/Users/youngwoong/Downloads/openarm_xhand1_blind_cube_0710/data/chunk-000/episode_000000.parquet";
const screenshotPath = process.env.OPENARM_SCREENSHOT ?? "/private/tmp/openarm-xhand1-viewer.png";

if (!existsSync(chromePath)) throw new Error(`Chrome executable not found: ${chromePath}`);
if (!existsSync(parquetPath)) throw new Error(`Parquet file not found: ${parquetPath}`);

function positionFromLabel(label) {
  const match = label.match(/\n\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s+m$/);
  if (!match) throw new Error(`Unable to parse joint position: ${label}`);
  return match.slice(1).map(Number);
}

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--disable-gpu-sandbox", "--enable-webgl"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(target, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="file"][accept=".parquet"]').setInputFiles(parquetPath);
  await page.waitForFunction(
    () => document.body.textContent?.includes("45 joints") && document.body.textContent?.includes("382 frames"),
    null,
    { timeout: 30000 },
  );

  const mappingSection = page.locator(".panel-section").filter({ hasText: "Mapping" });
  const mappingText = await mappingSection.textContent();
  const stateColumn = await page.locator('input[list="parquet-columns"]').inputValue();
  const urdfPath = await page.locator(".source-panel .field input").first().inputValue();

  async function jointPosition(jointName) {
    const row = page.locator(".joint-row").filter({ hasText: jointName });
    const count = await row.count();
    if (count !== 1) throw new Error(`Expected one row for ${jointName}, found ${count}`);
    await row.hover();
    return positionFromLabel(await page.locator(".coordinate-label").innerText());
  }

  const frame0Wrist = await jointPosition("openarm_left_joint7");
  const frame0LeftThumb1 = await jointPosition("left_hand_thumb_rota_joint1");
  const frame0LeftThumb2 = await jointPosition("left_hand_thumb_rota_joint2");
  const frame0RightThumb1 = await jointPosition("right_hand_thumb_rota_joint1");
  const frame0RightThumb2 = await jointPosition("right_hand_thumb_rota_joint2");

  await page.locator('input[type="range"]').fill("100");
  const frame100Wrist = await jointPosition("openarm_left_joint7");
  const frame100LeftThumb1 = await jointPosition("left_hand_thumb_rota_joint1");
  const frame100LeftThumb2 = await jointPosition("left_hand_thumb_rota_joint2");
  const frame100RightThumb1 = await jointPosition("right_hand_thumb_rota_joint1");
  const frame100RightThumb2 = await jointPosition("right_hand_thumb_rota_joint2");
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const thumbDeltaZ = {
    frame0Left: frame0LeftThumb2[2] - frame0LeftThumb1[2],
    frame0Right: frame0RightThumb2[2] - frame0RightThumb1[2],
    frame100Left: frame100LeftThumb2[2] - frame100LeftThumb1[2],
    frame100Right: frame100RightThumb2[2] - frame100RightThumb1[2],
  };

  if (urdfPath !== "/assets/openarm-xhand1/openarm_xhand1.urdf") {
    throw new Error(`OpenArm preset was not selected: ${urdfPath}`);
  }
  if (stateColumn !== "observation.joint_position") {
    throw new Error(`Unexpected state column: ${stateColumn}`);
  }
  if (!mappingText?.includes("Auto (openarm-xhand1-40)")) {
    throw new Error(`Unexpected mapping: ${mappingText}`);
  }
  if (!mappingText.includes("Head order") || !mappingText.includes("0 pitch · 1 yaw") || mappingText.includes("44 yaw")) {
    throw new Error(`Unexpected OpenArm head-order UI: ${mappingText}`);
  }
  if (frame0Wrist.every((value, index) => value === frame100Wrist[index])) {
    throw new Error(`Wrist pose did not change between frames: ${frame0Wrist.join(", ")}`);
  }
  if (Object.values(thumbDeltaZ).some((value) => value <= 0)) {
    throw new Error(`Thumbs are not oriented upward: ${JSON.stringify(thumbDeltaZ)}`);
  }
  if (errors.length > 0) throw new Error(`Browser errors: ${errors.join(" | ")}`);

  console.log(
    JSON.stringify(
      {
        urdfPath,
        stateColumn,
        headOrder: ["pitch", "yaw"],
        mapping: "openarm-xhand1-40",
        frames: 382,
        frame0Wrist,
        frame100Wrist,
        thumbDeltaZ,
        screenshotPath,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
