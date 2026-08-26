const fs = require("fs");
const path = require("path");

const PLACE_ID = "2753915549";
const DB_FILE = path.join(__dirname, "data", "servers.json");

const NORMAL_INTERVAL = 60 * 1000;
const TTL_MS = 5 * 60 * 1000;

const MAX_RETRIES = 6;
const BASE_BACKOFF = 5000;

const ROBLOX_API =
    `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public`;

function loadServers() {
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    } catch {
        return [];
    }
}

function saveServers(servers) {
    fs.writeFileSync(
        DB_FILE,
        JSON.stringify(servers, null, 2)
    );
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPage(cursor = "") {
    const url =
        `${ROBLOX_API}?sortOrder=Asc&limit=100` +
        (cursor
            ? `&cursor=${encodeURIComponent(cursor)}`
            : "");

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url, {
                headers: {
                    "User-Agent": "BloxFruitsHopCollector/1.0"
                }
            });

            if (response.ok) {
                return await response.json();
            }

            if (response.status === 429) {
                const retryAfter =
                    Number(response.headers.get("retry-after"));

                const wait =
                    Number.isFinite(retryAfter) &&
                    retryAfter > 0
                        ? retryAfter * 1000
                        : Math.min(
                            BASE_BACKOFF *
                            Math.pow(2, attempt),
                            120000
                        );

                console.log(
                    `[429] Rate limited. Waiting ${Math.ceil(wait / 1000)}s...`
                );

                await sleep(wait);
                continue;
            }

            if (response.status >= 500) {
                const wait = Math.min(
                    BASE_BACKOFF *
                    Math.pow(2, attempt),
                    120000
                );

                console.log(
                    `[${response.status}] Roblox server error. Retrying in ${Math.ceil(wait / 1000)}s...`
                );

                await sleep(wait);
                continue;
            }

            throw new Error(
                `Roblox HTTP ${response.status}`
            );

        } catch (error) {
            if (attempt === MAX_RETRIES) {
                throw error;
            }

            const wait = Math.min(
                BASE_BACKOFF *
                Math.pow(2, attempt),
                120000
            );

            console.log(
                `[Retry] ${error.message} | waiting ${Math.ceil(wait / 1000)}s`
            );

            await sleep(wait);
        }
    }

    throw new Error("Maximum retries exceeded");
}

async function scan() {
    console.log(
        `[${new Date().toISOString()}] Scanning...`
    );

    const existing = new Map(
        loadServers().map(server => [
            server.jobId,
            server
        ])
    );

    let cursor = "";
    let pages = 0;

    try {
        do {
            const data = await fetchPage(cursor);

            pages++;

            const now = Date.now();

            for (const server of data.data || []) {
                if (!server.id) continue;

                existing.set(server.id, {
                    jobId: server.id,
                    playing: Number(server.playing) || 0,
                    maxPlayers:
                        Number(server.maxPlayers) || 0,
                    updatedAt: now,
                    lastSeen: now
                });
            }

            cursor = data.nextPageCursor || "";

            if (cursor) {
                await sleep(3000);
            }

        } while (cursor && pages < 3);

        const now = Date.now();

        const active = [...existing.values()].filter(
            server =>
                now - server.lastSeen <= TTL_MS
        );

        saveServers(active);

        console.log(
            `Updated ${active.length} active servers | pages=${pages}`
        );

    } catch (error) {
        console.error(
            `[Collector] ${error.message}`
        );
    }
}

async function main() {
    console.log(
        "Blox Fruits Collector started"
    );

    while (true) {
        await scan();

        console.log(
            `Next scan in ${NORMAL_INTERVAL / 1000}s`
        );

        await sleep(NORMAL_INTERVAL);
    }
}

main().catch(error => {
    console.error(
        "[FATAL]",
        error
    );

    process.exit(1);
});
