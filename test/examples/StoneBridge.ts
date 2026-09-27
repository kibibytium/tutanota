import type { BaseLocator } from "../../src/platform-kit/base/BaseLocator.js"
import { createBaseLocator } from "../../src/platform-kit/base/BaseLocator.js"
import type { LoginListener } from "../../src/platform-kit/base/facades/LoginFacade.js"
import type { MainInterface } from "../../src/applications/common/api/worker/workerInterfaces.js"
import type { NativeInterface } from "../../src/app-kit/native-bridge/common/NativeInterface.js"
import type { BrowserData } from "../../src/platform-kit/app-env/boot/ClientConstants.js"
import { NamedClientModel } from "../../src/platform-kit/instance-pipeline"
import { ClientPlatform } from "../../src/platform-kit/app-env/boot/ClientDetector.js"
import { PresentableKeyVerificationState, SessionType } from "../../src/platform-kit/app-env"
import { tutanotaModelInfo, tutanotaTypeModels } from "../../src/entities/tutanota"
import { baseModelInfo, baseTypeModels } from "../../src/entities/base"
import { sysModelInfo, sysTypeModels } from "../../src/entities/sys"
import { driveModelInfo, driveTypeModels } from "../../src/entities/drive"
import { storageModelInfo, storageTypeModels } from "../../src/entities/storage"
import { monitorModelInfo, monitorTypeModels } from "../../src/entities/monitor"
import { usageModelInfo, usageTypeModels } from "../../src/entities/usage"
import { accountingModelInfo, accountingTypeModels } from "../../src/entities/accounting"
import { AppNameEnum } from "../../src/platform-kit/meta/TypeRef.js"
import { lazyMemoized, Nullable } from "../../src/platform-kit/utils"
import { LateInitializedCacheStorageImpl } from "../../src/app-kit/local-store/CacheStorageProxy.js"
import { EphemeralCacheStorage } from "../../src/app-kit/local-store/EphemeralCacheStorage.js"
import { CustomCacheHandlerMap } from "../../src/app-kit/local-store/CustomCacheHandler.js"
import { NoOpLastProcessedEventBatchStorageFacade } from "../../src/applications/common/api/worker/LastProcessedEventBatchStorageFacade.js"
import { loadWasmFromFileOrNetwork } from "../../src/platform-kit/utils/WebAssembly.js"
import { type Argon2IDExports, generateKeyFromPassphraseArgon2id } from "../../src/platform-kit/crypto"
import { RsaWeb } from "../../src/app-kit/native-bridge/worker/RsaImplementation.js"
import { TutanotaEntityMigrator } from "../../src/applications/common/api/worker/TutanotaEntityMigrator.js"
import { DefaultEntityRestCache } from "../../src/applications/common/api/worker/rest/DefaultEntityRestCache.js"
import { DomainConfigProvider } from "../../src/applications/common/api/common/DomainConfigProvider.js"
import { IdentityKeyTrustDatabase } from "../../src/platform-kit/base/base-crypto/persistence/IdentityKeyTrustDatabase"
import { MailFacade } from "../../src/applications/common/api/worker/facades/lazy/MailFacade"
import { BlobFacade } from "../../src/applications/common/api/worker/facades/lazy/BlobFacade"
import { NativeFileApp } from "../../src/app-kit/native-bridge/common/FileApp"
import { DesktopFileFacade } from "../../src/applications/common/desktop/files/DesktopFileFacade"
import { ExportFacade, NativeCryptoFacade } from "../../src/app-kit/native-bridge/common/generatedipc/types"
import { EntityClient } from "../../src/platform-kit/network/EntityClient"
import { initClientModels } from "../../src/applications/common/api/common/ClientModelInfoInitializer"
import { ConversationType, MailMethod, PartialRecipient, Recipient, RecipientType } from "../../src/entities/tutanota/Utils"
// @ts-ignore
import xhr2 from "xhr2"
import http from "node:http"
import fs from "node:fs"

const SOCKET_PATH = "/tmp/stone-bridge.sock"
const SERVER_HOST = "app.tuta.com"
const SERVER_URL = `https://${SERVER_HOST}`

;(globalThis as any).env = {
	staticUrl: SERVER_URL,
	versionNumber: "360.260922.0",
	dist: false,
	mode: "Prod",
	networkDebugging: false,
	domainConfigs: {
		[SERVER_HOST]: {
			firstPartyDomain: true,
			partneredDomainTransitionUrl: SERVER_URL,
			apiUrl: SERVER_URL,
			paymentUrl: `${SERVER_URL}/braintree.html`,
			webauthnUrl: `${SERVER_URL}/webauthn`,
			legacyWebauthnUrl: `${SERVER_URL}/webauthn`,
			webauthnMobileUrl: `${SERVER_URL}/webauthnmobile`,
			legacyWebauthnMobileUrl: `${SERVER_URL}/webauthnmobile`,
			webauthnRpId: SERVER_HOST,
			u2fAppId: `${SERVER_URL}/u2f-appid.json`,
			giftCardBaseUrl: `${SERVER_URL}/giftcard`,
			referralBaseUrl: `${SERVER_URL}/signup`,
			websiteBaseUrl: "https://tuta.com",
		},
		"{hostname}": {
			firstPartyDomain: false,
			partneredDomainTransitionUrl: "{protocol}//{hostname}",
			apiUrl: "{protocol}//{hostname}",
			paymentUrl: "https://pay.tutanota.com/braintree.html",
			webauthnUrl: "{protocol}//{hostname}/webauthn",
			legacyWebauthnUrl: "{protocol}//{hostname}/webauthn",
			webauthnMobileUrl: "{protocol}//{hostname}/webauthnmobile",
			legacyWebauthnMobileUrl: "{protocol}//{hostname}/webauthnmobile",
			webauthnRpId: "{hostname}",
			u2fAppId: "{protocol}//{hostname}/u2f-appid.json",
			giftCardBaseUrl: "https://app.tuta.com/giftcard",
			referralBaseUrl: "https://app.tuta.com/signup",
			websiteBaseUrl: "https://tuta.com",
		},
	},
}
;(globalThis as any).isBrowser = false
;(globalThis as any).self = globalThis
;(globalThis as any).XMLHttpRequest = xhr2

type SocketMessage = {
	recipient: string
	subject: string
	body: string
}

export async function getBaseLocator(loginAddress: string, passphrase: string): Promise<BaseLocator> {
	// ── argon2 facade (wasm from test/build/) ─────────────────────────────────────

	const argon2Wasm = await loadWasmFromFileOrNetwork<Argon2IDExports>("argon2.wasm", new URL("./", import.meta.url).href)
	const argon2idFacade = {
		async generateKeyFromPassphrase(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
			return generateKeyFromPassphraseArgon2id(argon2Wasm, passphrase, salt)
		},
	}

	// ── apps ──────────────────────────────────────────────────────────────────────

	const apps: Array<NamedClientModel> = [
		{ app: AppNameEnum.Base, clientModel: baseTypeModels, modelInfo: baseModelInfo },
		{ app: "sys", clientModel: sysTypeModels, modelInfo: sysModelInfo },
		{ app: "tutanota", clientModel: tutanotaTypeModels, modelInfo: tutanotaModelInfo },
		{ app: "drive", clientModel: driveTypeModels, modelInfo: driveModelInfo },
		{ app: "storage", clientModel: storageTypeModels, modelInfo: storageModelInfo },
		{ app: "monitor", clientModel: monitorTypeModels, modelInfo: monitorModelInfo },
		{ app: "usage", clientModel: usageTypeModels, modelInfo: usageModelInfo },
		{ app: "accounting", clientModel: accountingTypeModels, modelInfo: accountingModelInfo },
	]

	// ── stubs ─────────────────────────────────────────────────────────────────────

	const noOpLoginListener: LoginListener = {
		async onPartialLoginSuccess() {},
		async onFullLoginSuccess() {},
		async onLoginFailure() {},
		async onSecondFactorChallenge() {},
		onResetSession() {},
	}

	const mainInterface: MainInterface = {
		loginListener: noOpLoginListener,
		wsConnectivityListener: { updateWebSocketState() {} } as any,
		progressTracker: { write() {} } as any,
		eventController: { onEntityEventsReceived() {}, onError() {} } as any,
		operationProgressTracker: { onProgress() {} } as any,
		infoMessageHandler: { onInfoMessage() {} } as any,
		syncTracker: { onSyncStarted() {}, onSyncCompleted() {} } as any,
		uploadProgressListener: { onProgress() {} } as any,
	}

	const worker: NativeInterface & { sendError(e: Error): Promise<void>; getMainInterface(): MainInterface } = {
		invokeNative(requestType: string, args: ReadonlyArray<unknown>): Promise<any> {
			throw new Error("invokeNative not supported: " + requestType)
		},
		sendError(e: Error): Promise<void> {
			console.error("Worker error:", e)
			return Promise.resolve()
		},
		getMainInterface(): MainInterface {
			return mainInterface
		},
	}

	const identityKeyTrustDatabase: IdentityKeyTrustDatabase = {
		async isIdentityKeyTrustDatabaseSupported() {
			return false
		},
		async getManuallyVerifiedEntries() {
			return new Map()
		},
		async trust(mailAddress, key, source) {
			return { publicIdentityKey: key, sourceOfTrust: source }
		},
		async untrust() {},
		async getTrustedEntry() {
			return null
		},
	}

	// ── setup & run ───────────────────────────────────────────────────────────────

	let base: BaseLocator

	const ephemeralStorageProvider = async () =>
		new EphemeralCacheStorage((base as any).instancePipeline.modelMapper, (base as any).typeModelResolver, new CustomCacheHandlerMap())

	const maybeUninitializedStorage = new LateInitializedCacheStorageImpl(
		async (error: Error) => console.error("Storage error:", error),
		ephemeralStorageProvider,
		async () => null,
	)

	const cacheManagement = lazyMemoized(async () => {
		const { CacheManagementFacade } = await import("../../src/applications/common/api/worker/facades/lazy/CacheManagementFacade.js")
		return new CacheManagementFacade(base.user, base.cachingEntityClient, base.cache as any)
	})

	const lastProcessedEventBatchStorageFacade = lazyMemoized(async () => new NoOpLastProcessedEventBatchStorageFacade())

	const browserData: BrowserData = {
		needsMicrotaskHack: false,
		needsExplicitIDBIds: false,
		indexedDbSupported: true,
		clientPlatform: ClientPlatform.UNKNOWN,
	}

	console.log("Creating BaseLocator...")
	const clientModelInfo = initClientModels(apps)
	const nativeCryptoFacade: Nullable<NativeCryptoFacade> = null
	base = await createBaseLocator({
		worker,
		clientModelInfo,
		browserData,
		loginListenerProvider: () => noOpLoginListener,
		maybeUninitializedStorage,
		lastProcessedEventBatchStorageFacade,
		cacheManagement,
		identityKeyTrustDatabase,
		domainConfig: new DomainConfigProvider().getCurrentDomainConfig(),
		argon2idFacade,
		rsa: new RsaWeb(),
		fileFacade: { writeToAppDir: async () => {}, readFromAppDir: async () => new Uint8Array(), deleteFromAppDir: async () => {} },
		nativeCryptoFacade,
		entityMigratorFactory: ({
			cryptoWrapper,
			user,
			keyLoader,
			cachingEntityClient,
			serviceExecutor,
			typeModelResolver,
			instancePipeline,
			restClient,
			crypto,
		}) =>
			new TutanotaEntityMigrator(
				cryptoWrapper,
				user,
				keyLoader,
				cachingEntityClient,
				serviceExecutor,
				typeModelResolver,
				instancePipeline,
				restClient,
				crypto,
			),
		entityRestCache: (entityRestClient, patchMerger, typeModelResolver, lastProcessed) =>
			new DefaultEntityRestCache(entityRestClient, maybeUninitializedStorage, typeModelResolver, patchMerger, lastProcessed),
	})
	await base.login.createSession(loginAddress, passphrase, "Linux node", SessionType.Temporary, null)

	return base
}

async function getMailFacade(base: BaseLocator) {
	const blobFacade = {} as BlobFacade
	const desktopFileFacade = {} as DesktopFileFacade
	const exportFacade = {} as ExportFacade
	const fileApp = new NativeFileApp(desktopFileFacade, exportFacade)
	const entityClient = new EntityClient(base.entityRestClient, base.typeModelResolver)
	return new MailFacade(
		base.user,
		entityClient,
		base.crypto,
		base.cryptoWrapper,
		base.serviceExecutor,
		blobFacade,
		fileApp,
		base.login,
		base.keyLoader,
		base.publicEncryptionKeyProvider,
	)
}

function startServer(onMessage: (body: string) => Promise<SendMailReturn>) {
	if (fs.existsSync(SOCKET_PATH)) {
		fs.unlinkSync(SOCKET_PATH)
	}

	const server = http.createServer((req, res) => {
		if (req.method === "POST") {
			let body = ""
			req.on("data", (chunk) => {
				body += chunk.toString()
			})
			req.on("end", async () => {
				let resp: SendMailReturn = await onMessage(body) // hand off the message to your handler
				res.writeHead(200, { "Content-Type": "application/json" })
				res.end(JSON.stringify(resp))
			})
		} else {
			res.writeHead(200, { "Content-Type": "text/plain" })
			res.end("Server is running\n")
		}
	})

	server.listen(SOCKET_PATH, () => {
		console.log(`Server listening on unix socket: ${SOCKET_PATH}`)
		fs.chmodSync(SOCKET_PATH, "766")
	})

	process.on("SIGINT", () => {
		server.close(() => {
			fs.unlinkSync(SOCKET_PATH)
			process.exit(0)
		})
	})

	return server
}

type SendMailReturn = {
	messageId: string
	recipient: string
}

async function sendMail(mailFacade: MailFacade, msg: SocketMessage, config: Record<string, string>): Promise<SendMailReturn> {
	const r: PartialRecipient = {
		address: msg.recipient,
		name: "Waygates User",
		type: RecipientType.INTERNAL,
	}
	const d = {
		subject: msg.subject,
		bodyText: msg.body,
		senderMailAddress: config.LOGIN_ADDRESS,
		senderName: "Sdk Mailer",
		toRecipients: [r],
		ccRecipients: [],
		bccRecipients: [],
		conversationType: ConversationType.NEW,
		previousMessageId: null,
		attachments: null,
		confidential: true,
		replyTos: [],
		method: MailMethod.NONE,
	}
	const newMail = await mailFacade.createDraft(d)
	const recipient: Recipient = {
		address: r.address,
		name: r.name,
		type: r.type,
		contact: null,
		verificationState: PresentableKeyVerificationState.NONE,
	}
	let sendDraftReturn = await mailFacade.sendDraft(newMail, [recipient], "en", null, false)
	return { messageId: sendDraftReturn.messageId, recipient: recipient.address }
}
function readConfig(filePath: string) {
	const config: Record<string, string> = {}
	const lines = fs.readFileSync(filePath, "utf-8").split("\n")

	for (let line of lines) {
		line = line.trim()

		// skip blank lines and full-line comments
		if (!line || line.startsWith("#")) continue

		const eqIndex = line.indexOf("=")
		if (eqIndex === -1) continue // skip malformed lines

		const key = line.slice(0, eqIndex).trim()
		const value = line.slice(eqIndex + 1).trim()

		config[key] = value
	}

	return config
}
async function run() {
	const config = readConfig("/stonebridge/config")
	const baseLocator = await getBaseLocator(config.LOGIN_ADDRESS, config.PASSWORD)
	const mailFacade = await getMailFacade(baseLocator)
	console.log("Created Mail Facade")

	startServer(async (newMessage: string) => {
		// fire-and-forget async handling
		const msg: SocketMessage = JSON.parse(newMessage)
		return await sendMail(mailFacade, msg, config)
	})
}

await run()
