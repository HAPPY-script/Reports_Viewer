const MEMBERS_PAGE_SIZE = 100;
let membersRenderIndex = 0;
let membersRenderList = [];
let membersLoadingMore = false;

// --- Supabase config (replace if necessary) ---
const SUPABASE_BASE = "https://koqaxxefwuosiplczazy.supabase.co";
const SUPABASE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvcWF4eGVmd3Vvc2lwbGN6YXp5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjI3MDU0MywiZXhwIjoyMDgxODQ2NTQzfQ.r5WrrZURA6Cpn4Ocf7x5mjGnOvOg8VYa0U92Dbgwh2M";

const API_BASE_MEMBER = SUPABASE_BASE + "/rest/v1/members";
const API_BASE_REPORTS = SUPABASE_BASE + "/rest/v1/reports";

/* =======================
   DOM REFERENCES
   ======================= */
const reportContainer = document.getElementById("report-container");
const memberContainer = document.getElementById("member-container");
const popup = document.getElementById("confirm-popup");
const confirmYes = document.getElementById("confirm-yes");
const confirmNo = document.getElementById("confirm-no");
const reloadBtn = document.getElementById("reload-btn");

const btnReports = document.getElementById("btn-reports");
const btnMembers = document.getElementById("btn-members");
const pageReports = document.getElementById("page-reports");
const pageMembers = document.getElementById("page-members");

const searchReportsInput = document.getElementById("search-reports");
const searchMembersInput = document.getElementById("search-members");
const filterGamesMinInput = document.getElementById("filter-games-min");
const filterGamesMaxInput = document.getElementById("filter-games-max");
const applyFilterBtn = document.getElementById("apply-filter");
const clearFilterBtn = document.getElementById("clear-filter");
const reportsCountEl = document.getElementById("reports-count");
const membersCountEl = document.getElementById("members-count");

const replyModal = document.getElementById("reply-modal");
const replyText = document.getElementById("reply-text");
const replySend = document.getElementById("reply-send");
const replyCancel = document.getElementById("reply-cancel");

const memberModal = document.getElementById("member-modal");
const memberModalClose = document.getElementById("member-modal-close");
const memberModalClose2 = document.getElementById("member-modal-close-2");
const memberAvatarEl = document.getElementById("member-avatar");
const memberUsernameEl = document.getElementById("member-username");
const memberUseridEl = document.getElementById("member-userid");
const memberGamecountEl = document.getElementById("member-gamecount");
const gameListEl = document.getElementById("game-list");

let reportsFilterEl = document.getElementById("reports-filter");
let currentReportFilter = "all";

let memberFilterContainer = null;
let currentMemberStatusFilter = "all";

let selectedPlayer = null;
let cachedReports = null;
let cachedMembers = null;
let pendingConfirmAction = null;
const avatarPromiseCache = {};
const DEFAULT_DELETE_RESPONSE = "The admin has reviewed your comment but has not responded.";

const HOURS72_MS = 72 * 3600 * 1000;
const MEMBER_ONLINE_TIMEOUT_MS = 120 * 1000; // 120 seconds

/* =======================
   Utilities
   ======================= */
function escapeHtml(unsafe) {
    return String(unsafe || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
function formatDate(ts) {
    if (!ts) return "";
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString();
}
async function getUserIdFromUsername(username) {
    try {
        const res = await fetch(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(username)}&limit=1`);
        if (!res.ok) return null;
        const json = await res.json();
        if (json && json.data && json.data.length > 0) return json.data[0].id;
        return null;
    } catch (e) { return null; }
}
async function fetchAvatarImageUrl(userId, size = "150x150") {
    if (!userId) return null;
    if (avatarPromiseCache[userId]) return avatarPromiseCache[userId];
    const p = (async () => {
        try {
            const url = `https://thumbnails.roproxy.com/v1/users/avatar-headshot?userIds=${userId}&size=${size}&format=Png&isCircular=false`;
            const res = await fetch(url);
            if (!res.ok) throw new Error("bad response");
            const json = await res.json();
            const d = json.data && json.data[0];
            if (d && d.imageUrl) return d.imageUrl;
            throw new Error("no imageUrl");
        } catch (e) {
            return `https://www.roblox.com/headshot-thumbnail/image?userId=1&width=150&height=150&format=Png`;
        }
    })();
    avatarPromiseCache[userId] = p;
    return p;
}

/* FIREBASE ESCAPE/UNESCAPE (kept for compatibility with existing messages) */
const FIREBASE_ESCAPE_MAP = {
    ".": "{DOT}",
    "#": "{HASH}",
    "$": "{DOLLAR}",
    "[": "{LBRACKET}",
    "]": "{RBRACKET}",
    "/": "{SLASH}",
    "\\": "{BACKSLASH}"
};
const FIREBASE_UNESCAPE_MAP = {};
for (const k in FIREBASE_ESCAPE_MAP) FIREBASE_UNESCAPE_MAP[FIREBASE_ESCAPE_MAP[k]] = k;

function decodeFirebaseMessage(encoded) {
    if (!encoded) return "";
    let s = String(encoded);
    s = s.replace(/\{0x([0-9A-Fa-f]{2})\}/g, function (_, hex) {
        const code = parseInt(hex, 16);
        if (!Number.isNaN(code)) return String.fromCharCode(code);
        return "";
    });
    for (const token in FIREBASE_UNESCAPE_MAP) {
        const ch = FIREBASE_UNESCAPE_MAP[token];
        s = s.split(token).join(ch);
    }
    return s;
}
function encodeFirebaseMessage(raw) {
    if (raw === null || raw === undefined) return "";
    let s = String(raw);
    s = s.replace(/[\x00-\x1F\x7F]/g, function (ch) {
        const code = ch.charCodeAt(0);
        return `{0x${code.toString(16).toUpperCase().padStart(2, "0")}}`;
    });
    for (const ch in FIREBASE_ESCAPE_MAP) {
        const token = FIREBASE_ESCAPE_MAP[ch];
        s = s.split(ch).join(token);
    }
    return s;
}

function debounce(fn, wait = 300) {
    let to;
    return (...args) => {
        clearTimeout(to);
        to = setTimeout(() => fn(...args), wait);
    };
}

/* =======================
   Supabase REST helpers
   ======================= */

// ---- fetchAllFromSupabase: fetch >1000 rows by looping with limit/offset ----
async function fetchAllFromSupabase(baseUrl) {
    const pageSize = 1000;
    const all = [];
    let offset = 0;
    // determine separator for query params
    const sep = baseUrl.indexOf('?') !== -1 ? '&' : '?';

    while (true) {
        const url = `${baseUrl}${sep}limit=${pageSize}&offset=${offset}`;
        const res = await fetch(url, { headers: supabaseHeaders() });
        if (!res.ok) throw new Error("Fetch failed: " + res.status);
        const rows = await res.json();
        if (!rows || rows.length === 0) break;
        all.push(...rows);
        if (rows.length < pageSize) break;
        offset += pageSize;
        // small delay to avoid hitting rate-limits
        await new Promise(r => setTimeout(r, 150));
    }
    return all;
}

function supabaseHeaders(extra = {}) {
    return Object.assign({
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
    }, extra || {});
}

// Convert Supabase rows -> old-style keyed object (username -> data)
function rowsToMembersObject(rows) {
    const out = {};
    if (!Array.isArray(rows)) return out;
    for (const r of rows) {
        const key = (r && r.username) ? String(r.username) : (r && r.user_id ? String(r.user_id) : null);
        if (!key) continue;
        // games may already be object (jsonb) or JSON string
        let gamesObj = {};
        if (r.games == null) gamesObj = {};
        else if (typeof r.games === "object") gamesObj = r.games;
        else {
            try { gamesObj = JSON.parse(r.games); } catch (e) { gamesObj = {}; }
        }
        out[key] = {
            ID: r.user_id || null,
            Username: r.username || key,
            Games: gamesObj,
            Online: r.online === true,
            LastSeen: r.last_seen || null
        };
    }
    return out;
}
function rowsToReportsObject(rows) {
    const out = {};
    if (!Array.isArray(rows)) return out;
    for (const r of rows) {
        const key = (r && r.player) ? String(r.player) : (r && r.user_id ? String(r.user_id) : null);
        if (!key) continue;
        out[key] = {
            userId: r.user_id || null,
            message: r.message || "",
            timestamp: r.timestamp || null,
            responded: !!r.responded,
            response: r.response || null,
            respondedAt: r.responded_at || r.respondedAt || null,
            responseType: r.response_type || null
        };
    }
    return out;
}

/* =======================
   Rendering helpers (unchanged)
   ======================= */
function updateTabCounts(reportsCount, membersCount) {
    if (btnReports) btnReports.textContent = reportsCount && reportsCount > 0 ? `Reports (${reportsCount})` : "Reports";
    if (btnMembers) btnMembers.textContent = membersCount && membersCount > 0 ? `Members (${membersCount})` : "Members";
    if (reportsCountEl) reportsCountEl.textContent = reportsCount ? `${reportsCount} result(s)` : "";
    if (membersCountEl) membersCountEl.textContent = membersCount ? `${membersCount} member(s)` : "";
}
function showPage(page) {
    if (page === "reports") {
        btnReports && btnReports.classList.add("active");
        btnMembers && btnMembers.classList.remove("active");
        pageReports && pageReports.classList.add("active");
        pageMembers && pageMembers.classList.remove("active");
    } else {
        btnMembers && btnMembers.classList.add("active");
        btnReports && btnReports.classList.remove("active");
        pageMembers && pageMembers.classList.add("active");
        pageReports && pageReports.classList.remove("active");
    }
}

/* =======================
   Filtering / Search (unchanged)
   ======================= */
function isNumericString(s) {
    return /^\d+$/.test(String(s).trim());
}

async function filterReportsObject(obj, query, statusFilter = "all") {
    if (!obj) return {};
    const sf = (statusFilter || "all").toString().toLowerCase();
    function statusMatches(r) {
        const responded = !!(r && (r.responded || r.response));
        let responseType = null;
        if (r && r.responseType) responseType = String(r.responseType);
        else if (r && r.response && r.response === DEFAULT_DELETE_RESPONSE) responseType = "delete";
        else if (responded) responseType = "reply";
        if (sf === "all") return true;
        if (sf === "unresolved") return !responded;
        if (sf === "resolved") return responded;
        if (sf === "deleted") return responseType === "delete";
        if (sf === "responded") return responseType === "reply";
        return true;
    }
    const raw = (query || "").toString().trim();
    if (!raw) {
        const out = {};
        for (const k of Object.keys(obj)) {
            const r = obj[k] || {};
            if (statusMatches(r)) out[k] = r;
        }
        return out;
    }
    const lineMatch = raw.match(/^\/\s*(\d+)\s*$/);
    if (lineMatch) {
        const n = parseInt(lineMatch[1], 10);
        if (!Number.isFinite(n) || n <= 0) return {};
        const unrespKeys = [];
        const respKeys = [];
        for (const key of Object.keys(obj)) {
            const r = obj[key] || {};
            const responded = !!(r.responded || r.response);
            if (responded) respKeys.push(key); else unrespKeys.push(key);
        }
        const allKeys = unrespKeys.concat(respKeys);
        const filteredKeys = allKeys.filter(k => statusMatches(obj[k] || {}));
        if (n > filteredKeys.length) return {};
        const pick = filteredKeys[n - 1];
        if (!pick) return {};
        return { [pick]: obj[pick] };
    }
    const q = raw.toLowerCase();
    const numeric = isNumericString(q) ? q : null;
    const out = {};
    for (const key of Object.keys(obj)) {
        const r = obj[key] || {};
        if (!statusMatches(r)) continue;
        const msg = decodeFirebaseMessage(r.message || "").toLowerCase();
        const username = key.toLowerCase();
        const userIdFromReport = r.userId ? String(r.userId) : null;
        let matched = false;
        if (username.includes(q)) matched = true;
        else if (msg.includes(q)) matched = true;
        else if (numeric && userIdFromReport && userIdFromReport.includes(numeric)) matched = true;
        else if (numeric && key.includes(numeric)) matched = true;
        if (matched) out[key] = r;
    }
    return out;
}

function filterMembersObject(obj, query, minGames, maxGames, statusFilter = "all") {
    if (!obj) return {};
    const rawQuery = (query || "").trim();
    const lineMatch = rawQuery.match(/^\/\s*(\d+)\s*$/);
    const nowMs = Date.now();
    const sf = (statusFilter || "all").toString().toLowerCase();

    function isMemberOnline(member) {
        if (!member) return false;
        if (member.Online !== true) return false;
        if (!member.LastSeen) return false;
        const lastMs = Number(member.LastSeen) * 1000;
        if (Number.isNaN(lastMs)) return false;
        return (nowMs - lastMs) <= MEMBER_ONLINE_TIMEOUT_MS;
    }

    function statusMatches(member) {
        if (sf === "all") return true;
        const online = isMemberOnline(member);
        if (sf === "online") return online === true;
        if (sf === "offline") return online === false;
        return true;
    }

    let min = Number.NEGATIVE_INFINITY;
    let max = Number.POSITIVE_INFINITY;
    if (minGames !== null && String(minGames).trim() !== "") {
        const v = parseInt(String(minGames).trim(), 10);
        if (!Number.isNaN(v)) min = v;
    }
    if (maxGames !== null && String(maxGames).trim() !== "") {
        const v = parseInt(String(maxGames).trim(), 10);
        if (!Number.isNaN(v)) max = v;
    }
    if (min > max) { const t = min; min = max; max = t; }

    if (lineMatch) {
        const n = parseInt(lineMatch[1], 10);
        if (!Number.isFinite(n) || n <= 0) return {};
        const allKeys = Object.keys(obj);
        if (n > allKeys.length) return {};
        const pickKey = allKeys[n - 1];
        const data = obj[pickKey];
        if (!statusMatches(data)) return {};
        const gamesObj = data && data.Games ? data.Games : {};
        const count = Object.keys(gamesObj).length;
        if (count < min || count > max) return {};
        const o = {};
        o[pickKey] = data;
        return o;
    }

    const q = rawQuery.toLowerCase();
    const numericQuery = /^\d+$/.test(q) ? q : null;
    const out = {};
    for (const username of Object.keys(obj)) {
        const data = obj[username] || {};
        if (!statusMatches(data)) continue;
        const uid = data.ID ? String(data.ID) : "";
        const gamesObj = data.Games || {};
        const gameKeys = Object.keys(gamesObj);
        const count = gameKeys.length;
        if (count < min || count > max) continue;
        if (!q) {
            out[username] = data;
            continue;
        }
        if (username.toLowerCase().includes(q) || uid.includes(q)) {
            out[username] = data;
            continue;
        }
        let matched = false;
        for (const gk of gameKeys) {
            const gkl = gk.toLowerCase();
            if (gkl.includes(q)) { matched = true; break; }
            if (numericQuery) {
                const digits = gk.match(/(\d{4,})/g);
                if (digits && digits.join(" ").includes(numericQuery)) {
                    matched = true;
                    break;
                }
            }
        }
        if (matched) out[username] = data;
    }
    return out;
}

/* =======================
   Rendering / Cards (unchanged)
   ======================= */
function makeNumberedRow(number, innerCard) {
    const wrapper = document.createElement("div");
    wrapper.className = "card-row";
    const badge = document.createElement("div");
    badge.className = "line-number";
    badge.textContent = number;
    wrapper.appendChild(badge);
    wrapper.appendChild(innerCard);
    return wrapper;
}

function createReportCard(playerKey, report, avatarUrl, userId, index = null) {
    const card = document.createElement("div");
    card.className = "card";
    const rawMessage = (report && report.message) ? decodeFirebaseMessage(report.message) : "(Không có nội dung)";
    const safeMessage = escapeHtml(rawMessage);
    const tsText = report && report.timestamp ? formatDate(report.timestamp) : "";
    const responded = !!(report && (report.responded || report.response));
    let responseType = null;
    if (report && report.responseType) responseType = String(report.responseType);
    else if (report && report.response && report.response === DEFAULT_DELETE_RESPONSE) responseType = "delete";
    else if (responded) responseType = "reply";
    const rawResponse = (report && report.response) ? decodeFirebaseMessage(report.response) : "";
    const responseText = escapeHtml(rawResponse);

    card.innerHTML = `
        <div class="top-section">
            <img class="avatar" src="${avatarUrl}" alt="avatar">
            <div class="info">
                <div class="name">👤 ${escapeHtml(playerKey)}</div>
                <div class="userid">ID: ${userId || "Không tìm thấy"}</div>
            </div>
        </div>
        <div class="message">${safeMessage}</div>
        <div class="timestamp">⏱ ${tsText}</div>
    `;

    if (responded) {
        if (responseType === "delete") card.classList.add("responded-delete");
        else card.classList.add("responded-reply");
    }

    if (responded && responseText) {
        const respDiv = document.createElement("div");
        respDiv.className = "admin-response";
        respDiv.innerHTML = `<strong>Admin:</strong> ${responseText}`;
        card.appendChild(respDiv);
    }

    if (responded) {
        const meta = document.createElement("div");
        meta.className = "waiting-meta";
        let expireInfo = "";
        const respondedAt = report.respondedAt || report.respondedAtMillis || report.respondedAt_ms || report.respondedTimestamp || report.responded_ts || report.timestamp || null;
        if (respondedAt) {
            const base = Number(respondedAt);
            const remainMs = (base + HOURS72_MS) - Date.now();
            if (remainMs > 0) {
                const hours = Math.floor(remainMs / (3600*1000));
                const mins = Math.floor((remainMs % (3600*1000))/(60*1000));
                expireInfo = ` • expires in ${hours}h${mins}m`;
            } else {
                expireInfo = ` • expires soon`;
            }
        }
        meta.textContent = "Waiting for user to delete report" + (expireInfo ? expireInfo : " (auto remove after 72h)");
        card.appendChild(meta);
        card.classList.add("waiting");
    }

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const btnRespond = document.createElement("button");
    btnRespond.className = "btn-respond";
    btnRespond.textContent = "Respond";
    const btnDelete = document.createElement("button");
    btnDelete.className = "btn-delete";
    btnDelete.textContent = "Delete";

    if (responded) {
        btnDelete.classList.add("btn-disabled");
        btnDelete.disabled = true;
        btnRespond.classList.add("btn-disabled");
        btnRespond.disabled = true;
    }

    actions.appendChild(btnRespond);
    actions.appendChild(btnDelete);
    card.appendChild(actions);

    const nameEl = card.querySelector(".name");
    if (nameEl) {
        nameEl.style.cursor = "pointer";
        nameEl.title = "Click để copy tên";
        nameEl.addEventListener("click", (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(playerKey).then(()=>alert(`Đã copy tên: ${playerKey}`)).catch(()=>alert("Copy thất bại"));
        });
    }
    const idEl = card.querySelector(".userid");
    if (idEl && userId) {
        idEl.style.cursor = "pointer";
        idEl.title = "Click để copy ID";
        idEl.addEventListener("click", (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(userId.toString()).then(()=>alert(`Đã copy ID: ${userId}`)).catch(()=>alert("Copy thất bại"));
        });
    }

    btnRespond.addEventListener("click", (e) => {
        e.stopPropagation();
        openReplyModal(playerKey, report);
    });

    btnDelete.addEventListener("click", (e) => {
        e.stopPropagation();
        selectedPlayer = playerKey;
        pendingConfirmAction = "delete-as-respond";
        const titleEl = document.getElementById("confirm-title");
        if (titleEl) titleEl.textContent = "This will send a default admin reply. Continue?";
        popup && popup.classList.add("show");
    });

    if (index !== null) return makeNumberedRow(index, card);
    return card;
}

async function renderReports(dataObj) {
    if (!reportContainer) return;
    reportContainer.innerHTML = "";
    if (!dataObj || Object.keys(dataObj).length === 0) {
        reportContainer.innerHTML = "<div class='loading'>Không có report nào.</div>";
        return;
    }
    cleanupOldResponded(dataObj).catch(err=>console.warn("cleanup error", err));

    const unrespKeys = [];
    const respKeys = [];
    for (const key of Object.keys(dataObj)) {
        const r = dataObj[key] || {};
        const responded = !!(r.responded || r.response);
        if (responded) respKeys.push(key); else unrespKeys.push(key);
    }
    const allKeys = unrespKeys.concat(respKeys);

    const frag = document.createDocumentFragment();
    let idx = 1;
    for (const playerKey of allKeys) {
        const report = dataObj[playerKey];
        let userId = (report && report.userId) ? report.userId : null;
        if (!userId) userId = await getUserIdFromUsername(playerKey);
        let avatarUrl = 'https://www.roblox.com/headshot-thumbnail/image?userId=1&width=150&height=150&format=Png';
        if (userId) {
            try {
                const url = await fetchAvatarImageUrl(userId, "150x150");
                if (url) avatarUrl = url;
            } catch (e) {}
        }
        const numbered = createReportCard(playerKey, report, avatarUrl, userId, idx);
        frag.appendChild(numbered);
        idx++;
    }
    reportContainer.appendChild(frag);
}

function prepareMembersList(filteredObj) {
    if (!filteredObj) return [];
    const nowMs = Date.now();
    const list = Object.keys(filteredObj).map(username => {
        const data = filteredObj[username] || {};
        const gameCount = data && data.Games ? Object.keys(data.Games).length : 0;
        const lastMs = data && data.LastSeen ? Number(data.LastSeen) * 1000 : 0;
        const isOnline = (data && data.Online === true && lastMs && !Number.isNaN(lastMs) && (nowMs - lastMs) <= MEMBER_ONLINE_TIMEOUT_MS) ? true : false;
        return { username, data, gameCount, isOnline };
    });

    list.sort((a,b) => {
        if (a.isOnline && !b.isOnline) return -1;
        if (!a.isOnline && b.isOnline) return 1;
        if (b.gameCount !== a.gameCount) return b.gameCount - a.gameCount;
        return a.username.localeCompare(b.username);
    });
    return list;
}

function renderMembersChunk() {
    if (!memberContainer) return;
    if (membersLoadingMore) return;
    if (membersRenderIndex >= membersRenderList.length) return;

    membersLoadingMore = true;
    const frag = document.createDocumentFragment();
    const nowMs = Date.now();

    const end = Math.min(membersRenderIndex + MEMBERS_PAGE_SIZE, membersRenderList.length);
    for (let i = membersRenderIndex; i < end; i++) {
        const e = membersRenderList[i];
        frag.appendChild(createMemberCard(e.username, e.data, i + 1, nowMs));
    }
    membersRenderIndex = end;
    memberContainer.appendChild(frag);
    membersLoadingMore = false;
}

function createMemberCard(username, data, index = null, nowMs = Date.now()) {
    const divCard = document.createElement("div");
    divCard.className = "member-card";

    const userId = (data && data.ID) ? data.ID : null;
    const avatarUrl = userId ? (`https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=100&height=100&format=Png`) : 'https://www.roblox.com/headshot-thumbnail/image?userId=1&width=100&height=100&format=Png';

    const gameCount = data && data.Games ? Object.keys(data.Games).length : 0;
    const gamesText = `Games: ${gameCount}`;

    let isOnline = false;
    if (data && data.Online === true && data.LastSeen) {
        const lastMs = Number(data.LastSeen) * 1000;
        if (!Number.isNaN(lastMs) && (nowMs - lastMs) <= MEMBER_ONLINE_TIMEOUT_MS) {
            isOnline = true;
        }
    }

    const statusClass = isOnline ? "status-online" : "status-offline";
    const statusText = isOnline ? "Online" : "Offline";

    divCard.innerHTML = `
        <img class="mavatar" src="${avatarUrl}" onerror="this.onerror=null;this.src='https://www.roblox.com/headshot-thumbnail/image?userId=1&width=100&height=100&format=Png'">
        <div class="mmeta">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div class="mname">${escapeHtml(username)}${userId ? ` • ${userId}` : ''}</div>
              <div class="mstatus ${statusClass}">
                <span class="status-dot" aria-hidden="true"></span>
                <span class="status-text">${statusText}</span>
              </div>
            </div>
            <div class="mgames">${escapeHtml(gamesText)}</div>
        </div>
    `;

    divCard.style.cursor = "pointer";
    divCard.addEventListener("click", (e) => {
        openMemberModal(username, data);
    });

    const nameEl = divCard.querySelector(".mname");
    if (nameEl) {
        nameEl.title = "Click để copy tên/ID";
        nameEl.style.cursor = "pointer";
        nameEl.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const toCopy = userId ? `${username} (${userId})` : username;
            navigator.clipboard.writeText(toCopy).then(()=>alert(`Đã copy: ${toCopy}`)).catch(()=>alert("Copy thất bại"));
        });
    }

    if (index !== null) return makeNumberedRow(index, divCard);
    return divCard;
}

async function renderMembers(dataObj) {
    if (!memberContainer) return;
    if (!dataObj || Object.keys(dataObj).length === 0) {
        memberContainer.innerHTML = "<div class='loading'>Chưa có thành viên nào.</div>";
        return;
    }

    membersRenderList = prepareMembersList(dataObj);
    membersRenderIndex = 0;
    memberContainer.innerHTML = "";
    renderMembersChunk();
}

/* =======================
   Member modal / game fetch
   ======================= */
function extractPlaceIdFromKey(key) {
    if (!key) return null;
    const m = key.match(/\((\d+)\)\s*$/);
    if (m) return m[1];
    const mm = key.match(/(\d{5,})/);
    return mm ? mm[1] : null;
}
async function fetchGameIcon(placeId) {
    if (!placeId) return null;
    try {
        const url = `https://thumbnails.roblox.com/v1/games/icons?placeIds=${placeId}&size=128x128&format=Png`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const j = await res.json();
        if (j && j.data && j.data.length > 0 && j.data[0].imageUrl) return j.data[0].imageUrl;
        return null;
    } catch (e) {
        return null;
    }
}
async function openMemberModal(username, memberData) {
    memberModal && memberModal.classList.add("show");
    memberModal && memberModal.setAttribute("aria-hidden", "false");

    memberUsernameEl.textContent = username;
    const uid = memberData && memberData.ID ? memberData.ID : null;
    memberUseridEl.textContent = uid ? `ID: ${uid}` : "ID: —";
    const gamesObj = memberData && memberData.Games ? memberData.Games : {};
    const gameKeys = Object.keys(gamesObj || {});
    memberGamecountEl.textContent = `Games: ${gameKeys.length}`;

    if (uid) {
        const avatarUrl = await fetchAvatarImageUrl(uid, "150x150").catch(()=>null);
        memberAvatarEl.src = avatarUrl || `https://www.roblox.com/headshot-thumbnail/image?userId=1&width=150&height=150&format=Png`;
    } else {
        memberAvatarEl.src = `https://www.roblox.com/headshot-thumbnail/image?userId=1&width=150&height=150&format=Png`;
    }

    gameListEl.innerHTML = `<div class="loading">Đang tải danh sách game...</div>`;
    if (gameKeys.length === 0) {
        gameListEl.innerHTML = `<div class="loading">Không có game nào.</div>`;
        return;
    }

    const promises = gameKeys.map(async (gkey) => {
        const placeId = extractPlaceIdFromKey(gkey);
        let displayName = gkey.replace(/\s*\(\d+\)\s*$/, "").trim();
        if (!displayName) displayName = gkey;
        const icon = placeId ? await fetchGameIcon(placeId) : null;
        return { key: gkey, name: displayName, placeId, icon };
    });

    const results = await Promise.all(promises);
    gameListEl.innerHTML = "";
    results.forEach(r => {
        const item = makeGameItem(r.name, r.placeId, r.icon);
        gameListEl.appendChild(item);
    });
}
function closeMemberModal() {
    memberModal && memberModal.classList.remove("show");
    memberModal && memberModal.setAttribute("aria-hidden", "true");
    gameListEl.innerHTML = "";
}
memberModalClose && memberModalClose.addEventListener("click", closeMemberModal);
memberModalClose2 && memberModalClose2.addEventListener("click", closeMemberModal);
const overlayEl = memberModal && memberModal.querySelector && memberModal.querySelector(".member-modal-overlay");
overlayEl && overlayEl.addEventListener("click", closeMemberModal);

function makeGameItem(gameName, placeId, iconUrl) {
    const item = document.createElement("div");
    item.className = "game-item";
    const thumb = document.createElement("img");
    thumb.className = "game-thumb";
    thumb.src = iconUrl || "https://www.roblox.com/asset-thumbnail/image?assetId=0&width=128&height=128&format=png";
    thumb.alt = gameName || "Game";

    const info = document.createElement("div");
    info.className = "game-info";
    const nameEl = document.createElement("div");
    nameEl.className = "game-name";
    nameEl.textContent = gameName || "Unknown Game";
    const idEl = document.createElement("div");
    idEl.className = "game-id";
    idEl.textContent = placeId ? `PlaceId: ${placeId}` : "PlaceId: —";

    info.appendChild(nameEl);
    info.appendChild(idEl);
    item.appendChild(thumb);
    item.appendChild(info);
    return item;
}

/* =======================
   Load / Respond / Delete (Supabase)
   ======================= */
async function loadReports() {
    if (!reportContainer) return;
    reportContainer.innerHTML = "<div class='loading'>Đang tải dữ liệu...</div>";
    try {
        const base = `${API_BASE_REPORTS}?select=*`;
        const rows = await fetchAllFromSupabase(base);
        cachedReports = rowsToReportsObject(rows);

        bindReportsFilter();
        const q = (searchReportsInput && searchReportsInput.value || "").trim();
        const filtered = await filterReportsObject(cachedReports, q, currentReportFilter);
        await renderReports(filtered);
        updateTabCounts(Object.keys(cachedReports).length, cachedMembers ? Object.keys(cachedMembers).length : 0);
    } catch (err) {
        reportContainer.innerHTML = "<div class='loading'>Lỗi tải dữ liệu.</div>";
        console.error(err);
    }
}

async function respondToReport(playerName, responseText, responseType = "reply") {
    const encodedResponse = encodeFirebaseMessage(responseText);
    const payload = {
        responded: true,
        response: encodedResponse,
        responded_at: Date.now(),
        response_type: responseType
    };
    try {
        const url = `${API_BASE_REPORTS}?player=eq.${encodeURIComponent(playerName)}`;
        const res = await fetch(url, {
            method: "PATCH",
            headers: supabaseHeaders(),
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error("respond failed: " + res.status);
        await quickRefreshCounts();
        await loadReports();
        return true;
    } catch (err) {
        console.error("respondToReport error", err);
        alert("Không thể gửi phản hồi. Xem console.");
        return false;
    }
}

async function removeReportCompletely(playerName) {
    try {
        const url = `${API_BASE_REPORTS}?player=eq.${encodeURIComponent(playerName)}`;
        const res = await fetch(url, {
            method: "DELETE",
            headers: supabaseHeaders()
        });
        if (!res.ok) throw new Error("delete failed: " + res.status);
        await quickRefreshCounts();
        await loadReports();
        return true;
    } catch (err) {
        console.error("removeReportCompletely error", err);
        return false;
    }
}

async function cleanupOldResponded(reportsObj) {
    if (!reportsObj) return;
    const keys = Object.keys(reportsObj);
    const now = Date.now();
    for (const key of keys) {
        const r = reportsObj[key];
        if (!r) continue;
        const responded = !!(r.responded || r.response);
        if (!responded) continue;
        const respondedAt = Number(r.respondedAt || r.responded_at || r.respondedAtMillis || r.respondedTimestamp || r.responded_ts || r.timestamp || 0);
        const base = respondedAt || (r.timestamp ? Number(r.timestamp) : 0);
        if (!base) continue;
        if (now - base >= HOURS72_MS) {
            try {
                await removeReportCompletely(key);
                console.log("Auto-removed expired responded report:", key);
            } catch (e) {
                console.warn("Auto remove failed for", key, e);
            }
        }
    }
}

/* =======================
   Members: load (Supabase)
   ======================= */
async function loadMembers() {
    if (!memberContainer) return;
    memberContainer.innerHTML = "<div class='loading'>Đang tải danh sách thành viên...</div>";
    try {
        const base = `${API_BASE_MEMBER}?select=user_id,username,games,online,last_seen`;
        const rows = await fetchAllFromSupabase(base);
        cachedMembers = rowsToMembersObject(rows);

        bindMembersFilterUI();

        const q = (searchMembersInput && searchMembersInput.value || "").trim();
        const minVal = (filterGamesMinInput && filterGamesMinInput.value || "").trim();
        const maxVal = (filterGamesMaxInput && filterGamesMaxInput.value || "").trim();
        const filteredObj = filterMembersObject(cachedMembers, q, minVal === "" ? null : minVal, maxVal === "" ? null : maxVal, currentMemberStatusFilter);

        membersRenderList = prepareMembersList(filteredObj);
        membersRenderIndex = 0;
        memberContainer.innerHTML = "";
        renderMembersChunk();

        updateTabCounts(Object.keys(cachedReports || {}).length, Object.keys(cachedMembers).length);
        if (membersCountEl) membersCountEl.textContent = `${membersRenderList.length} member(s)`;
    } catch (err) {
        memberContainer.innerHTML = "<div class='loading'>Lỗi tải dữ liệu thành viên.</div>";
        console.error(err);
    }
}

/* =======================
   Scroll handler for infinite scroll
   ======================= */
if (memberContainer) {
    memberContainer.addEventListener("scroll", () => {
        const nearBottom = memberContainer.scrollTop + memberContainer.clientHeight >= (memberContainer.scrollHeight - 200);
        if (nearBottom && membersRenderIndex < membersRenderList.length) {
            renderMembersChunk();
        }
    });
}

/* =======================
   Counts & Polling (Supabase-based)
   ======================= */
async function getReportsCount() {
    try {
        const url = `${API_BASE_REPORTS}?select=player`;
        // Try HEAD + Prefer count=exact (fast if CORS allows)
        const headRes = await fetch(url, { method: "HEAD", headers: supabaseHeaders({ "Prefer": "count=exact" }) });
        if (headRes.ok) {
            const cr = headRes.headers.get("content-range");
            if (cr) {
                const m = cr.match(/\/(\d+)$/);
                if (m) return parseInt(m[1], 10);
            }
        }
        // fallback: fetch all and count
        const rows = await fetchAllFromSupabase(url);
        return rows.length;
    } catch (e) { return 0; }
}

async function getMembersCount() {
    try {
        const url = `${API_BASE_MEMBER}?select=user_id`;
        const headRes = await fetch(url, { method: "HEAD", headers: supabaseHeaders({ "Prefer": "count=exact" }) });
        if (headRes.ok) {
            const cr = headRes.headers.get("content-range");
            if (cr) {
                const m = cr.match(/\/(\d+)$/);
                if (m) return parseInt(m[1], 10);
            }
        }
        const rows = await fetchAllFromSupabase(url);
        return rows.length;
    } catch (e) { return 0; }
}

async function quickRefreshCounts() {
    const [rCount, mCount] = await Promise.all([getReportsCount(), getMembersCount()]);
    updateTabCounts(rCount, mCount);
}
let countsIntervalHandle = null;
function startCountsPolling(interval = 7000) {
    quickRefreshCounts();
    if (countsIntervalHandle) clearInterval(countsIntervalHandle);
    countsIntervalHandle = setInterval(quickRefreshCounts, interval);
}

/* =======================
   Auto-polling functions
   ======================= */
let reportsPollTimeout = null;
async function autoLoadReports(interval = 5000) {
    try {
        const base = `${API_BASE_REPORTS}?select=*`;
        const rows = await fetchAllFromSupabase(base);
        const obj = rowsToReportsObject(rows);
        if (JSON.stringify(obj || {}) !== JSON.stringify(cachedReports || {})) {
            cachedReports = obj;
            if (pageReports && pageReports.classList.contains("active")) {
                const q = (searchReportsInput && searchReportsInput.value || "").trim();
                const filtered = await filterReportsObject(cachedReports, q, currentReportFilter);
                await renderReports(filtered);
            }
        }
    } catch (err) {
        console.error("Auto load error:", err);
    } finally {
        reportsPollTimeout = setTimeout(() => autoLoadReports(interval), interval);
    }
}

let membersPollTimeout = null;
async function autoLoadMembers(interval = 12000) {
    try {
        const base = `${API_BASE_MEMBER}?select=user_id,username,games,online,last_seen`;
        const rows = await fetchAllFromSupabase(base);
        const obj = rowsToMembersObject(rows);
        if (JSON.stringify(obj || {}) !== JSON.stringify(cachedMembers || {})) {
            cachedMembers = obj;
            if (pageMembers && pageMembers.classList.contains("active")) {
                const q = (searchMembersInput && searchMembersInput.value || "").trim();
                const minVal = (filterGamesMinInput && filterGamesMinInput.value || "").trim();
                const maxVal = (filterGamesMaxInput && filterGamesMaxInput.value || "").trim();
                const filteredObj = filterMembersObject(cachedMembers || {}, q, minVal === "" ? null : minVal, maxVal === "" ? null : maxVal, currentMemberStatusFilter);

                membersRenderList = prepareMembersList(filteredObj);
                membersRenderIndex = 0;
                memberContainer.innerHTML = "";
                renderMembersChunk();

                if (membersCountEl) membersCountEl.textContent = `${membersRenderList.length} member(s)`;
                updateTabCounts(Object.keys(cachedReports || {}).length, Object.keys(cachedMembers).length);
            }
        }
    } catch (err) {
        console.error("Members auto load error:", err);
    } finally {
        membersPollTimeout = setTimeout(() => autoLoadMembers(interval), interval);
    }
}

/* =======================
   Popup / Confirm
   ======================= */
function showConfirm(playerName, action) { selectedPlayer = playerName; pendingConfirmAction = action || "delete-as-respond"; popup && popup.classList.add("show"); }
function hideConfirm() { selectedPlayer = null; pendingConfirmAction = null; popup && popup.classList.remove("show"); }
confirmYes && confirmYes.addEventListener("click", async () => {
    popup && popup.classList.remove("show");
    if (!selectedPlayer) return;
    if (pendingConfirmAction === "delete-as-respond") {
        await respondToReport(selectedPlayer, DEFAULT_DELETE_RESPONSE, "delete");
    }
    selectedPlayer = null;
    pendingConfirmAction = null;
});
confirmNo && confirmNo.addEventListener("click", hideConfirm);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideConfirm(); });

/* =======================
   Reply modal
   ======================= */
function openReplyModal(playerName, report) {
    selectedPlayer = playerName;
    if (replyText) replyText.value = "";
    replyModal && replyModal.classList.add("show");
}
function closeReplyModal() {
    replyModal && replyModal.classList.remove("show");
    if (replyText) replyText.value = "";
    selectedPlayer = null;
}
replyCancel && replyCancel.addEventListener("click", closeReplyModal);
replyModal && replyModal.addEventListener("click", (ev) => {
    if (ev.target === replyModal) closeReplyModal();
});
replySend && replySend.addEventListener("click", async () => {
    const text = (replyText && replyText.value || "").trim();
    if (!text) { alert("Please enter a response."); return; }
    if (!selectedPlayer) { alert("No player selected."); closeReplyModal(); return; }
    const ok = await respondToReport(selectedPlayer, text, "reply");
    if (ok) closeReplyModal();
});

/* =======================
   Event wiring & search handlers
   ======================= */
reloadBtn && reloadBtn.addEventListener("click", async () => {
    if (pageReports && pageReports.classList.contains("active")) await loadReports();
    else await loadMembers();
    await quickRefreshCounts();
});
btnReports && btnReports.addEventListener("click", async () => {
    showPage("reports");
    if (!cachedReports) await loadReports();
});
btnMembers && btnMembers.addEventListener("click", async () => {
    showPage("members");
    if (!cachedMembers) await loadMembers();
});

const onSearchReports = debounce(async () => {
    const q = (searchReportsInput && searchReportsInput.value || "").trim();
    const filtered = await filterReportsObject(cachedReports || {}, q, currentReportFilter);
    await renderReports(filtered);
    if (reportsCountEl) reportsCountEl.textContent = Object.keys(filtered || {}).length + " result(s)";
}, 300);

const onSearchMembers = debounce(async () => {
    const q = (searchMembersInput && searchMembersInput.value || "").trim();
    const minVal = (filterGamesMinInput && filterGamesMinInput.value || "").trim();
    const maxVal = (filterGamesMaxInput && filterGamesMaxInput.value || "").trim();
    const filteredObj = filterMembersObject(cachedMembers || {}, q, minVal === "" ? null : minVal, maxVal === "" ? null : maxVal, currentMemberStatusFilter);

    membersRenderList = prepareMembersList(filteredObj);
    membersRenderIndex = 0;
    memberContainer.innerHTML = "";
    renderMembersChunk();
    if (membersCountEl) membersCountEl.textContent = `${membersRenderList.length} member(s)`;
}, 300);

searchReportsInput && searchReportsInput.addEventListener("input", onSearchReports);
searchMembersInput && searchMembersInput.addEventListener("input", onSearchMembers);

async function filterAndRenderReports(q) {
    const filtered = await filterReportsObject(cachedReports || {}, q, currentReportFilter);
    await renderReports(filtered);
    if (reportsCountEl) reportsCountEl.textContent = Object.keys(filtered || {}).length + " result(s)";
}

/* =======================
   Reports filter binding
   ======================= */
let reportsFilterBound = false;
function bindReportsFilter() {
    if (reportsFilterBound) return;
    const el = reportsFilterEl || document.getElementById("reports-filter");
    if (!el) return;
    reportsFilterEl = el;

    reportsFilterEl.addEventListener("click", (ev) => {
        const target = ev.target;
        const btn = (target && typeof target.closest === "function") ? target.closest(".filter-btn") : null;
        if (!btn) return;
        const f = btn.getAttribute("data-filter");
        if (!f) return;
        currentReportFilter = f;
        const allBtns = reportsFilterEl.querySelectorAll(".filter-btn");
        allBtns.forEach(b => b.classList.toggle("active", b === btn));
        const q = (searchReportsInput && searchReportsInput.value || "").trim();
        filterAndRenderReports(q);
    });

    const initialActive = reportsFilterEl.querySelector(".filter-btn.active");
    if (initialActive) {
        const init = initialActive.getAttribute("data-filter");
        if (init) currentReportFilter = init;
    }

    reportsFilterBound = true;
}
bindReportsFilter();
document.addEventListener("DOMContentLoaded", bindReportsFilter);

/* =======================
   Members filter UI binding
   ======================= */
function bindMembersFilterUI() {
    if (memberFilterContainer) return;
    const controls = pageMembers && pageMembers.querySelector ? pageMembers.querySelector(".page-controls") : null;
    if (!controls) return;

    const container = document.createElement("div");
    container.className = "members-filter";
    container.style.display = "flex";
    container.style.gap = "8px";
    container.style.alignItems = "center";
    container.style.marginLeft = "12px";

    const label = document.createElement("div");
    label.textContent = "Status:";
    label.style.color = "rgba(200,200,255,0.6)";
    label.style.fontSize = "13px";
    container.appendChild(label);

    const btnAll = document.createElement("button");
    btnAll.className = "member-filter-btn active";
    btnAll.setAttribute("data-filter", "all");
    btnAll.textContent = "All";
    const btnOnline = document.createElement("button");
    btnOnline.className = "member-filter-btn";
    btnOnline.setAttribute("data-filter", "online");
    btnOnline.textContent = "Online";
    const btnOffline = document.createElement("button");
    btnOffline.className = "member-filter-btn";
    btnOffline.setAttribute("data-filter", "offline");
    btnOffline.textContent = "Offline";

    [btnAll, btnOnline, btnOffline].forEach(b => {
        b.style.padding = "6px 10px";
        b.style.borderRadius = "6px";
        b.style.border = "1px solid rgba(255,255,255,0.04)";
        b.style.background = "transparent";
        b.style.cursor = "pointer";
    });
    btnAll.style.fontWeight = "600";

    container.appendChild(btnAll);
    container.appendChild(btnOnline);
    container.appendChild(btnOffline);

    controls.appendChild(container);
    memberFilterContainer = container;

    container.addEventListener("click", (ev) => {
        const t = ev.target;
        const btn = (t && typeof t.closest === "function") ? t.closest(".member-filter-btn") : null;
        if (!btn) return;
        const filter = btn.getAttribute("data-filter");
        if (!filter) return;
        currentMemberStatusFilter = filter;
        const all = container.querySelectorAll(".member-filter-btn");
        all.forEach(b => b.classList.toggle("active", b === btn));
        const q = (searchMembersInput && searchMembersInput.value || "").trim();
        const minVal = (filterGamesMinInput && filterGamesMinInput.value || "").trim();
        const maxVal = (filterGamesMaxInput && filterGamesMaxInput.value || "").trim();
        const filtered = filterMembersObject(cachedMembers || {}, q, minVal === "" ? null : minVal, maxVal === "" ? null : maxVal, currentMemberStatusFilter);
        renderMembers(filtered);
        if (membersCountEl) membersCountEl.textContent = Object.keys(filtered || {}).length + " member(s)";
    });
}
bindMembersFilterUI();
document.addEventListener("DOMContentLoaded", bindMembersFilterUI);

/* =======================
   Filter apply / clear
   ======================= */
applyFilterBtn && applyFilterBtn.addEventListener("click", async () => {
    const q = (searchMembersInput && searchMembersInput.value || "").trim();
    const minVal = (filterGamesMinInput && filterGamesMinInput.value || "").trim();
    const maxVal = (filterGamesMaxInput && filterGamesMaxInput.value || "").trim();

    const filteredObj = filterMembersObject(cachedMembers || {}, q, minVal === "" ? null : minVal, maxVal === "" ? null : maxVal, currentMemberStatusFilter);
    membersRenderList = prepareMembersList(filteredObj);
    membersRenderIndex = 0;
    memberContainer.innerHTML = "";
    renderMembersChunk();
    if (membersCountEl) membersCountEl.textContent = `${membersRenderList.length} member(s)`;
});

clearFilterBtn && clearFilterBtn.addEventListener("click", async () => {
    if (filterGamesMinInput) filterGamesMinInput.value = "";
    if (filterGamesMaxInput) filterGamesMaxInput.value = "";
    if (searchMembersInput) searchMembersInput.value = "";
    await loadMembers();
});

/* =======================
   Init / start polling
   ======================= */
(async function init() {
    startCountsPolling(7000);
    await quickRefreshCounts();
    await loadReports();
    autoLoadReports(5000);
    autoLoadMembers(12000);
})();

/* =======================
   Scroll to top button
   ======================= */
const scrollBtn = document.getElementById("scrollTopBtn");
if (scrollBtn) {
    window.addEventListener("scroll", () => {
        const y = window.scrollY || document.documentElement.scrollTop;
        if (y > 120) scrollBtn.classList.add("show");
        else scrollBtn.classList.remove("show");
    });

    scrollBtn.addEventListener("click", () => {
        let start = window.scrollY || document.documentElement.scrollTop;
        if (start <= 0) return;
        let duration = Math.min(800, Math.max(250, start / 2));
        const startTime = performance.now();
        function scrollStep(now) {
            const progress = Math.min((now - startTime) / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 3);
            window.scrollTo(0, start * (1 - ease));
            if (progress < 1) requestAnimationFrame(scrollStep);
        }
        requestAnimationFrame(scrollStep);
    });
}
