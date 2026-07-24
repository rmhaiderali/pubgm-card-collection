import fs from "fs"
import path from "path"
import { promisify } from "util"
import child_process from "child_process"
import { onExit } from "signal-exit"

const overwrite = false

function cmdObjectToString(kvEntries) {
  return kvEntries
    .flat()
    .map((v) => JSON.stringify(v))
    .join(" ")
}

const spawn = child_process.spawn
const exec = promisify(child_process.exec)
const readDir = (path) => fs.readdirSync(path, { withFileTypes: true })

function execute(cmdObject) {
  return exec(cmdObjectToString(cmdObject))
}

const ext = ".webp"
const input = "screenshots"
const output = "dist"
const temp = "temp" + ext

const outputHtml = output + "/index.html"
await execute(["rm", "-f", outputHtml])

if (!fs.existsSync(input)) {
  console.error("No " + input + " directory found in the current directory")
  process.exit(1)
}

if (overwrite) await execute(["rm", "-rf", output])
if (!fs.existsSync(output)) fs.mkdirSync(output)

const PORT = 3000
const BASE = "/pubgm-card-collection"
const staticServerUrl = "http://localhost:" + PORT + BASE

const staticServer = spawn(
  "node",
  ["node_modules/serve-static-files", output],
  { env: { ...process.env, PORT, BASE } },
)

function cleanup() {
  if (fs.existsSync(temp)) fs.unlinkSync(temp)
  console.log("Stopping static server")
  staticServer.kill("SIGTERM")
}

onExit(cleanup)

const close = new Promise((resolve) => {
  staticServer.on("close", () => resolve(false))
})

staticServer.stderr.on("data", (data) => {
  console.log(data.toString())
})

const firstDataPromise = new Promise((resolve) => {
  staticServer.stdout.once("data", (data) => {
    resolve(data.toString())
  })
})

const firstData = await Promise.race([firstDataPromise, close])
if (!firstData) process.exit(2)
console.log(firstData)

const secondDataPromise = new Promise((resolve) => {
  staticServer.stdout.once("data", (data) => {
    resolve(data.toString())
  })
})

const secondData = await Promise.race([secondDataPromise, close])
if (!secondData) process.exit(3)
console.log(secondData)

if (!secondData.includes(staticServerUrl)) {
  console.error("Failed to start static server")
  process.exit(4)
}

process.on("uncaughtException", (err) => {
  console.error(err.message)
  process.exit(5)
})

process.on("unhandledRejection", (err) => {
  console.error(err.message)
  process.exit(6)
})

for (const version of readDir(input)) {
  const input1 = input + "/" + version.name
  const output1 = output + "/" + version.name
  if (!fs.existsSync(output1)) fs.mkdirSync(output1)

  const output1Html = output1 + "/index.html"
  await execute(["rm", "-f", output1Html])

  for (const collection of readDir(input1)) {
    const input2 = input1 + "/" + collection.name
    const output2 = output1 + "/" + collection.name
    if (!fs.existsSync(output2)) fs.mkdirSync(output2)

    const output2Html = output2 + "/index.html"
    await execute(["rm", "-f", output2Html])

    for (const card of readDir(input2)) {
      const input3 = input2 + "/" + card.name
      const output3 = output2 + "/" + path.parse(card.name).name + ext

      if (!overwrite && fs.existsSync(output3)) {
        console.log("already exist: " + output3)
        continue
      }

      // prettier-ignore
      const cmdObject = [
        ["ffmpeg", "-y"],
        ["-i", input3],
        ["-i", "mask.svg"],
        ["-filter_complex", "[1:v]alphaextract[mask];[0:v][mask]alphamerge,crop=668:978:884:52"],
        ["-c:v", "libwebp"],
        ["-lossless", "0"],
        ["-compression_level", "6"],
        // ["-q:v", "100"],
        [temp],
      ]

      await execute(cmdObject)

      await execute(["mv", temp, output3])

      console.log("done: " + output3)
    }

    await execute([
      ["curl"],
      [staticServerUrl + "/" + version.name + "/" + collection.name + "/"],
      ["-o", output2Html],
    ])
  }

  await execute([
    ["curl"],
    [staticServerUrl + "/" + version.name + "/"],
    ["-o", output1Html],
  ])
}

await execute([["curl"], [staticServerUrl + "/"], ["-o", outputHtml]])

process.exit(0)
