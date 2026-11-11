import { env } from "node:process";
import type { APIRoute } from "astro";
import {
	BROADCAST_SESSION_COOKIE,
	BROADCAST_SESSION_MAX_AGE_SECONDS,
	createBroadcastSessionToken,
	verifyBroadcastPasscode,
} from "@/lib/broadcastAuth";

export const POST: APIRoute = async ({ request, cookies }) => {
	const expectedOrigin = env.SITE_ORIGIN;
	const requestOrigin = request.headers.get("origin");

	if (!expectedOrigin) {
		console.error("SITE_ORIGIN must be configured on the server.");
		return Response.json({ success: false }, { status: 500 });
	}

	if (!requestOrigin || requestOrigin !== expectedOrigin) {
		return Response.json({ success: false }, { status: 403 });
	}

	if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
		return Response.json({ success: false }, { status: 415 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ success: false }, { status: 400 });
	}

	const code =
		typeof body === "object" && body !== null && "code" in body
			? body.code
			: undefined;
	const passcodeHash = env.BROADCAST_PASSCODE_HASH;

	if (!passcodeHash) {
		console.error("BROADCAST_PASSCODE_HASH must be configured on the server.");
		return Response.json({ success: false }, { status: 500 });
	}

	if (typeof code !== "string" || !(await verifyBroadcastPasscode(code, passcodeHash))) {
		return Response.json({ success: false }, { status: 401 });
	}

	const sessionSecret = env.BROADCAST_SESSION_SECRET;
	if (!sessionSecret) {
		console.error("BROADCAST_SESSION_SECRET must be configured on the server.");
		return Response.json({ success: false }, { status: 500 });
	}

	cookies.set(
		BROADCAST_SESSION_COOKIE,
		createBroadcastSessionToken(sessionSecret),
		{
			path: "/",
			httpOnly: true,
			secure: import.meta.env.PROD,
			sameSite: "lax",
			maxAge: BROADCAST_SESSION_MAX_AGE_SECONDS,
		},
	);

	return Response.json({ success: true });
};
