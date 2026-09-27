import { rolldown } from "rolldown"
import { copyFileSync, existsSync, mkdirSync } from "node:fs"

export async function build() {
	if (!existsSync("build/liboqs.wasm") || !existsSync("build/argon2.wasm") || !existsSync("build/crypto_primitives_bg.wasm")) {
		throw new Error("wasm files were found in build/ — project is not built")
	}

	mkdirSync("stonebridge", { recursive: true })
	copyFileSync("build/argon2.wasm", "stonebridge/argon2.wasm")
	copyFileSync("build/liboqs.wasm", "stonebridge/liboqs.wasm")
	copyFileSync("build/crypto_primitives_bg.wasm", "stonebridge/crypto_primitives_bg.wasm")

	const bundle = await rolldown({
		input: { app: "test/examples/StoneBridge" },
		platform: "node",
	})
	await bundle.write({
		dir: `./stonebridge/`,
		format: "esm",
		codeSplitting: false,
	})
}

await build()
