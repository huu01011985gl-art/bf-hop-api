const express = require("express");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "";

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "servers.json");

const TTL_MS = 5 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, "[]");
}

function loadServers() {
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    } catch {
        return [];
    }
}

function saveServers(servers) {
    fs.writeFileSync(DB_FILE, JSON.stringify(servers, null, 2));
}

function cleanup() {
    const now = Date.now();
    const servers = loadServers();

    const active = servers.filter(
        server => now - server.lastSeen <= TTL_MS
    );

    if (active.length !== servers.length) {
        saveServers(active);
    }

    return active;
}

function auth(req, res, next) {
    if (!API_KEY) return next();

    const key =
        req.headers.authorization?.replace(/^Bearer\s+/i, "") ||
        req.query.api_key;

    if (key !== API_KEY) {
        return res.status(401).json({
            error: "Invalid API key"
        });
    }

    next();
}

app.get("/api/status", (req, res) => {
    const servers = cleanup();

    res.json({
        status: "online",
        service: "Blox Fruits Hop API",
        servers: servers.length,
        timestamp: Date.now()
    });
});

app.get("/api/servers", auth, (req, res) => {
    let servers = cleanup();

    const minPlayers = Number(req.query.minPlayers) || 0;
    const maxPlayers =
        req.query.maxPlayers !== undefined
            ? Number(req.query.maxPlayers)
            : Infinity;

    const limit = Math.min(
        Math.max(Number(req.query.limit) || 20, 1),
        100
    );

    servers = servers.filter(server =>
        server.playing >= minPlayers &&
        server.playing <= maxPlayers
    );

    res.json({
        count: servers.length,
        servers: servers.slice(0, limit)
    });
});

app.get("/api/servers/next", auth, (req, res) => {
    const servers = cleanup();

    const minPlayers = Number(req.query.minPlayers) || 0;
    const maxPlayers =
        req.query.maxPlayers !== undefined
            ? Number(req.query.maxPlayers)
            : Infinity;

    const candidates = servers.filter(server =>
        server.playing >= minPlayers &&
        server.playing <= maxPlayers
    );

    if (!candidates.length) {
        return res.status(404).json({
            error: "No suitable server found"
        });
    }

    const server =
        candidates[Math.floor(Math.random() * candidates.length)];

    res.json(server);
});

app.get("/api/servers/:jobId", auth, (req, res) => {
    const servers = cleanup();

    const server = servers.find(
        server => server.jobId === req.params.jobId
    );

    if (!server) {
        return res.status(404).json({
            error: "Server not found"
        });
    }

    res.json(server);
});

app.post("/api/servers/report", auth, (req, res) => {
    const { jobId, playing, maxPlayers, region } = req.body;

    if (!jobId) {
        return res.status(400).json({
            error: "jobId is required"
        });
    }

    const servers = cleanup();
    const now = Date.now();

    const data = {
        jobId: String(jobId),
        playing: Number(playing) || 0,
        maxPlayers: Number(maxPlayers) || 0,
        region: region || null,
        updatedAt: now,
        lastSeen: now
    };

    const index = servers.findIndex(
        server => server.jobId === data.jobId
    );

    if (index === -1) {
        servers.push(data);
    } else {
        servers[index] = {
            ...servers[index],
            ...data
        };
    }

    saveServers(servers);

    res.json({
        success: true,
        server: data
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Blox Fruits Hop API running on port ${PORT}`);
});
app.get("/api/boss/next", auth, (req, res) => {
    const bossName = String(req.query.boss || "").trim();

    if (!bossName) {
        return res.status(400).json({
            error: "boss parameter is required"
        });
    }

    const servers = cleanup();

    const matches = servers.filter(server =>
        Array.isArray(server.bosses) &&
        server.bosses.some(
            boss => String(boss.name).toLowerCase() === bossName.toLowerCase()
        )
    );

    if (!matches.length) {
        return res.status(404).json({
            error: "No server found for this boss"
        });
    }

    const server =
        matches[Math.floor(Math.random() * matches.length)];

    res.json({
        success: true,
        boss: bossName,
        server
    });
});

app.post("/api/boss/report", auth, (req, res) => {
    const {
        jobId,
        boss,
        playing,
        maxPlayers,
        region
    } = req.body;

    if (!jobId || !boss) {
        return res.status(400).json({
            error: "jobId and boss are required"
        });
    }

    const servers = cleanup();
    const now = Date.now();

    let server = servers.find(
        item => item.jobId === String(jobId)
    );

    if (!server) {
        server = {
            jobId: String(jobId),
            playing: Number(playing) || 0,
            maxPlayers: Number(maxPlayers) || 0,
            region: region || null,
            updatedAt: now,
            lastSeen: now,
            bosses: []
        };

        servers.push(server);
    }

    if (!Array.isArray(server.bosses)) {
        server.bosses = [];
    }

    const bossName = String(boss.name || boss).trim();

    const existingBoss = server.bosses.find(
        item => item.name.toLowerCase() === bossName.toLowerCase()
    );

    const bossData = {
        name: bossName,
        detectedAt: existingBoss?.detectedAt || now,
        lastSeen: now
    };

    if (existingBoss) {
        Object.assign(existingBoss, bossData);
    } else {
        server.bosses.push(bossData);
    }

    server.playing = Number(playing) || server.playing;
    server.maxPlayers = Number(maxPlayers) || server.maxPlayers;
    server.region = region || server.region;
    server.updatedAt = now;
    server.lastSeen = now;

    saveServers(servers);

    res.json({
        success: true,
        server
    });
});
