import { createHmac, scrypt, timingSafeEqual } from "node:crypto";

export const BROADCAST_SESSION_COOKIE = "page_access_token";
export const BROADCAST_SESSION_MAX_AGE_SECONDS = 3630;

const PASSCODE_HASH_BYTES = 64;

function derivePasscodeHash(passcode: string, salt: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(
			passcode,
			salt,
			PASSCODE_HASH_BYTES,
			{ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
			(error, derivedKey) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(derivedKey);
			},
		);
	});
}

function signSessionExpiry(expiresAt: number, secret: string): string {
	return createHmac("sha256", secret).update(String(expiresAt)).digest("hex");
}

export async function verifyBroadcastPasscode(
	passcode: string,
	encodedHash: string,
): Promise<boolean> {
	const [algorithm, saltHex, hashHex, ...extraParts] = encodedHash.split("$");
	if (
		algorithm !== "scrypt" ||
		!saltHex ||
		!hashHex ||
		extraParts.length > 0 ||
		!/^[a-f0-9]{32}$/i.test(saltHex) ||
		!/^[a-f0-9]{128}$/i.test(hashHex)
	) {
		throw new Error("BROADCAST_PASSCODE_HASH has an invalid format.");
	}

	const expectedHash = Buffer.from(hashHex, "hex");
	const actualHash = await derivePasscodeHash(passcode, Buffer.from(saltHex, "hex"));

	return timingSafeEqual(actualHash, expectedHash);
}

export function createBroadcastSessionToken(secret: string, now = Date.now()): string {
	const expiresAt = Math.floor(now / 1000) + BROADCAST_SESSION_MAX_AGE_SECONDS;
	return `${expiresAt}.${signSessionExpiry(expiresAt, secret)}`;
}

export function isBroadcastSessionValid(
	token: string | undefined,
	secret: string,
	now = Date.now(),
): boolean {
	if (!token) return false;

	const [expiryText, signature, ...extraParts] = token.split(".");
	if (!expiryText || !signature || extraParts.length > 0) return false;

	const expiresAt = Number(expiryText);
	if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) {
		return false;
	}

	const expectedSignature = Buffer.from(signSessionExpiry(expiresAt, secret), "hex");
	const providedSignature = Buffer.from(signature, "hex");
	return (
		providedSignature.length === expectedSignature.length &&
		timingSafeEqual(providedSignature, expectedSignature)
	);
}
