import fs from "fs"
import path from "path"
import { promisify } from "util"
import child_process from "child_process"
import kill from "tree-kill"

function cmdObjectToString(kvEntries) {
  return kvEntries
    .flat()
    .map((v) => JSON.stringify(v))
    .join(" ")
}

const spawn = child_process.spawn
const exec = promisify(child_process.exec)
const readDir = (path) => fs.readdirSync(path, { withFileTypes: true })

const staticServer = spawn(
  "node",
  ["node_modules/serve-static-files", "dist"],
  { env: { ...process.env, PORT: 3000, BASE: "/pubgm-card-collection" } },
)

const staticServerUrl = "http://localhost:3000/pubgm-card-collection"

staticServer.on("close", () => {
  console.log("static server stopped")
})

staticServer.stderr.on("data", (data) => {
  console.log(data.toString())
})

const chunk1 = await new Promise((resolve) => {
  staticServer.stdout.once("data", (data) => {
    resolve(data)
  })
})

const chunk2 = await new Promise((resolve) => {
  staticServer.stdout.once("data", (data) => {
    resolve(data)
  })
})

const chunk1String = chunk1.toString()
const chunk2String = chunk2.toString()

console.log(chunk1String)
console.log(chunk2String)

const startedServerSuccessfully = chunk2String.includes("http://localhost:3000")

function cleanup() {
  kill(staticServer.pid)
}

process.on("exit", cleanup)

process.on("SIGINT", cleanup)

process.on("SIGTERM", cleanup)

process.on("uncaughtException", (err) => {
  console.error(err.message)
  cleanup()
})

process.on("unhandledRejection", (err) => {
  console.error(err.message)
  cleanup()
})

if (!startedServerSuccessfully) {
  console.error("Failed to start static server")
  cleanup()
  process.exit(1)
}

if (!fs.existsSync("screenshots")) {
  console.error("No screenshots directory found in the current directory")
  cleanup()
  process.exit(2)
}

await exec("rm -rf dist")
await exec("mkdir dist")

const input = "screenshots"
const output = "dist"

for (const version of readDir(input)) {
  const input1 = input + "/" + version.name
  const output1 = output + "/" + version.name
  fs.mkdirSync(output1)

  for (const collection of readDir(input1)) {
    const input2 = input1 + "/" + collection.name
    const output2 = output1 + "/" + collection.name
    fs.mkdirSync(output2)

    for (const card of readDir(input2)) {
      const input3 = input2 + "/" + card.name
      const output3 = output2 + "/" + path.parse(card.name).name + ".webp"

      // prettier-ignore
      const cmdObject = [
        ["ffmpeg"],
        ["-i", input3],
        ["-i", "mask.svg"],
        ["-filter_complex", "[1:v]alphaextract[mask];[0:v][mask]alphamerge,crop=668:978:884:52"],
        ["-c:v", "libwebp"],
        ["-lossless", "0"],
        ["-compression_level", "6"],
        // ["-q:v", "100"],
        [output3],
      ]

      const cmd = cmdObjectToString(cmdObject)

      await exec(cmd)

      console.log("done: " + output3)
    }

    await exec(
      "curl " +
        staticServerUrl +
        "/" +
        version.name +
        "/" +
        collection.name +
        "/ -o " +
        output2 +
        "/index.html",
    )
  }

  await exec(
    "curl " +
      staticServerUrl +
      "/" +
      version.name +
      "/ -o " +
      output1 +
      "/index.html",
  )
}

await exec("curl " + staticServerUrl + "/ -o " + output + "/index.html")

cleanup()
