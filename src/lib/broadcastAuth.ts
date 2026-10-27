import { createHmac, timingSafeEqual } from "node:crypto";

export const BROADCAST_SESSION_COOKIE = "page_access_token";
export const BROADCAST_SESSION_MAX_AGE_SECONDS = 3630;

function signSessionExpiry(expiresAt: number, secret: string): string {
	return createHmac("sha256", secret).update(String(expiresAt)).digest("hex");
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
