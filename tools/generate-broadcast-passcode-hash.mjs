import { randomBytes, scryptSync } from "node:crypto";

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
	console.error("Run this script in an interactive terminal.");
	process.exit(1);
}

process.stdout.write("Enter the broadcast passcode (input hidden): ");
process.stdin.setEncoding("utf8");
process.stdin.setRawMode(true);
process.stdin.resume();

let passcode = "";
let finished = false;

function finish(error) {
	if (finished) return;
	finished = true;
	process.stdin.setRawMode(false);
	process.stdin.pause();
	process.stdout.write("\n");

	if (error) {
		console.error(error);
		process.exitCode = 1;
		return;
	}

	if (!passcode) {
		console.error("Passcode cannot be empty.");
		process.exitCode = 1;
		return;
	}

	const salt = randomBytes(16);
	const hash = scryptSync(passcode, salt, 64, {
		N: 16384,
		r: 8,
		p: 1,
		maxmem: 64 * 1024 * 1024,
	});

	process.stdout.write(`BROADCAST_PASSCODE_HASH=scrypt$${salt.toString("hex")}$${hash.toString("hex")}\n`);
	passcode = "";
}

process.stdin.on("data", (chunk) => {
	for (const character of chunk) {
		if (character === "\u0003") {
			finish("Cancelled.");
			process.exitCode = 130;
			return;
		}
		if (character === "\r" || character === "\n") {
			finish();
			return;
		}
		if (character === "\u007f" || character === "\b") {
			passcode = Array.from(passcode).slice(0, -1).join("");
		} else {
			passcode += character;
		}
	}
});
