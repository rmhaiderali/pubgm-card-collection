import fs from "fs"
import path from "path"
import { promisify } from "util"
import child_process from "child_process"
import { onExit } from "signal-exit"

const overwrite = false
const exifLog = false
const exifFields = ["Software", "Date/Time Original"]

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

const dir = { input: "screenshots", mask: "masks", output: "dist" }
const ext = { input: ".png", mask: ".svg", output: ".webp" }
const temp = "temp" + ext.output

const defaultMask = "default"

const maskMap = {
  "global/4.5/playful-battleground-3.0/01": "karamabit_blazing_sun",
  "in/4.5/playful-battleground-3.0/01": "karamabit_blazing_sun",
}

function getMaskByCard(cardPath) {
  const { dir, name } = path.parse(cardPath)
  const uniquePart = dir + "/" + name
  return maskMap[uniquePart] || defaultMask
}

const defaultCrop = "664:976:886:52"

const cropMap = {
  "global/4.5/playful-battleground-3.0/01": "675:977:882:51",
  "in/4.5/playful-battleground-3.0/01": "675:977:882:51",
}

function getCropByCard(cardPath) {
  const { dir, name } = path.parse(cardPath)
  const uniquePart = dir + "/" + name
  return cropMap[uniquePart] || defaultCrop
}

function pathWithoutExt(filePath) {
  return filePath.substring(0, filePath.lastIndexOf("."))
}

const outputHtml = dir.output + "/index.html"
await execute(["rm", "-f", outputHtml])

if (!fs.existsSync(dir.input)) {
  console.error("No " + dir.input + " directory found in the current directory")
  process.exit(1)
}

if (overwrite) await execute(["rm", "-rf", dir.output])
if (!fs.existsSync(dir.output)) fs.mkdirSync(dir.output)

const PORT = 3000
const BASE = "/pubgm-card-collection"
const staticServerUrl = "http://localhost:" + PORT + BASE

const staticServer = spawn(
  "node",
  ["node_modules/serve-static-files", dir.output],
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

for (const region of readDir(dir.input)) {
  const link1 = region.name
  const input1 = dir.input + "/" + link1
  const output1 = dir.output + "/" + link1
  if (!fs.existsSync(output1)) fs.mkdirSync(output1)

  const output1Html = output1 + "/index.html"
  await execute(["rm", "-f", output1Html])

  for (const version of readDir(input1)) {
    const link2 = link1 + "/" + version.name
    const input2 = dir.input + "/" + link2
    const output2 = dir.output + "/" + link2
    if (!fs.existsSync(output2)) fs.mkdirSync(output2)

    const output2Html = output2 + "/index.html"
    await execute(["rm", "-f", output2Html])

    for (const collection of readDir(input2)) {
      const link3 = link2 + "/" + collection.name
      const input3 = dir.input + "/" + link3
      const output3 = dir.output + "/" + link3
      if (!fs.existsSync(output3)) fs.mkdirSync(output3)

      const output3Html = output3 + "/index.html"
      await execute(["rm", "-f", output3Html])

      for (const card of readDir(input3)) {
        const link4 = link3 + "/" + card.name
        const input4 = dir.input + "/" + link4
        const output4 = dir.output + "/" + pathWithoutExt(link4) + ext.output

        if (exifLog) {
          const regex = new RegExp(exifFields.map(RegExp.escape).join("|"))

          const exiftool = await execute(["exiftool", input4])

          const lines = exiftool.stdout
            .split("\n")
            .filter((line) => line.match(regex))

          for (const line of lines) console.log(line.replace(/\s+/g, " "))
        }

        // Not using fs.existsSync() because it will resolve
        // symlinks and we want to check if symlink itself exists
        // For regular files it behaves the same as fs.existsSync()
        let output4Exist = false

        try {
          output4Exist = !!fs.lstatSync(output4)
        } catch (e) {}

        if (!overwrite && output4Exist) {
          console.log("already exist: " + output4 + "\n")
          continue
        }

        if (fs.lstatSync(input4).isSymbolicLink()) {
          const target = pathWithoutExt(fs.readlinkSync(input4)) + ext.output
          fs.symlinkSync(target, output4)
          console.log("symlinked: " + output4 + "\n")
          continue
        }

        // prettier-ignore
        const cmdObject = [
          ["ffmpeg", "-y"],
          ["-i", input4],
          ["-i", dir.mask + "/" + getMaskByCard(link4) + ext.mask],
          ["-filter_complex", "[1:v]alphaextract[mask];[0:v][mask]alphamerge,crop=" + getCropByCard(link4)],
          ["-c:v", "libwebp"],
          ["-lossless", "0"],
          ["-compression_level", "6"],
          // ["-q:v", "100"],
          [temp],
        ]

        await execute(cmdObject)

        await execute(["mv", temp, output4])

        console.log("done: " + output4 + "\n")
      }

      await execute([
        ["curl"],
        [staticServerUrl + "/" + link3 + "/"],
        ["-o", output3Html],
      ])
    }

    await execute([
      ["curl"],
      [staticServerUrl + "/" + link2 + "/"],
      ["-o", output2Html],
    ])
  }

  await execute([
    ["curl"],
    [staticServerUrl + "/" + link1 + "/"],
    ["-o", output1Html],
  ])
}

await execute([["curl"], [staticServerUrl + "/"], ["-o", outputHtml]])

process.exit(0)
