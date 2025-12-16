// CONFIG
const API_BASE_REPORTS = "https://happy-script-bada6-default-rtdb.asia-southeast1.firebasedatabase.app/reports";
const API_URL_REPORTS = API_BASE_REPORTS + ".json";
const API_BASE_MEMBER = "https://happy-script-bada6-default-rtdb.asia-southeast1.firebasedatabase.app/Member";
const API_URL_MEMBER = API_BASE_MEMBER + ".json";

// DOM refs
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

// Reply modal elements
const replyModal = document.getElementById("reply-modal");
const replyText = document.getElementById("reply-text");
const replySend = document.getElementById("reply-send");
const replyCancel = document.getElementById("reply-cancel");

// Member modal elements
const memberModal = document.getElementById("member-modal");
const memberModalClose = document.getElementById("member-modal-close");
const memberModalClose2 = document.getElementById("member-modal-close-2");
const memberAvatarEl = document.getElementById("member-avatar");
const memberUsernameEl = document.getElementById("member-username");
const memberUseridEl = document.getElementById("member-userid");
const memberGamecountEl = document.getElementById("member-gamecount");
const gameListEl = document.getElementById("game-list");

// Report filter UI element (can be bound later)
let reportsFilterEl = document.getElementById("reports-filter");
let currentReportFilter = "all"; // possible values: "all","unresolved","resolved","deleted","responded"

let selectedPlayer = null;
let cachedReports = null;
let cachedMembers = null;
let pendingConfirmAction = null; // "delete-as-respond" etc
const avatarPromiseCache = {};
const DEFAULT_DELETE_RESPONSE = "The admin has reviewed your comment but has not responded.";

const HOURS72_MS = 72 * 3600 * 1000;

// ---------- utilities ----------
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

// ---------- FIREBASE ESCAPE/UNESCAPE (CLIENT SIDE) ----------
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

/**
 * decodeFirebaseMessage(encoded)
 * - decode tokens {0xNN} to raw control char
 * - decode tokens like {DOT} back to '.'
 */
function decodeFirebaseMessage(encoded) {
    if (!encoded) return "";
    let s = String(encoded);

    // decode {0xNN} -> char
    s = s.replace(/\{0x([0-9A-Fa-f]{2})\}/g, function (_, hex) {
        const code = parseInt(hex, 16);
        if (!Number.isNaN(code)) return String.fromCharCode(code);
        return "";
    });

    // decode token map
    for (const token in FIREBASE_UNESCAPE_MAP) {
        const ch = FIREBASE_UNESCAPE_MAP[token];
        s = s.split(token).join(ch);
    }

    return s;
}

/**
 * encodeFirebaseMessage(raw)
 * - encode control chars (0x00-0x1F and 0x7F) as {0xNN}
 * - replace forbidden firebase chars with tokens like {DOT}
 */
function encodeFirebaseMessage(raw) {
    if (raw === null || raw === undefined) return "";
    let s = String(raw);

    // encode control chars first
    s = s.replace(/[\x00-\x1F\x7F]/g, function (ch) {
        const code = ch.charCodeAt(0);
        return `{0x${code.toString(16).toUpperCase().padStart(2, "0")}}`;
    });

    // replace forbidden characters
    for (const ch in FIREBASE_ESCAPE_MAP) {
        const token = FIREBASE_ESCAPE_MAP[ch];
        s = s.split(ch).join(token);
    }
    return s;
}

// simple debounce
function debounce(fn, wait = 300) {
    let to;
    return (...args) => {
        clearTimeout(to);
        to = setTimeout(() => fn(...args), wait);
    };
}

// ---------- UI helpers ----------
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

// ---------- Filtering/Search logic ----------
function isNumericString(s) {
    return /^\d+$/.test(String(s).trim());
}

/*
  filterReportsObject(obj, query, statusFilter)

  - query: supports "/<n>" (line search).
  - statusFilter: "all" | "unresolved" | "resolved" | "deleted" | "responded"
*/
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

    // If no query (empty) -> return all reports that match status
    if (!raw) {
        const out = {};
        for (const k of Object.keys(obj)) {
            const r = obj[k] || {};
            if (statusMatches(r)) out[k] = r;
        }
        return out;
    }

    // line-search "/<n>" -> apply status filter then pick nth in ordered list
    const lineMatch = raw.match(/^\/\s*(\d+)\s*$/);
    if (lineMatch) {
        const n = parseInt(lineMatch[1], 10);
        if (!Number.isFinite(n) || n <= 0) return {};
        // build ordered keys: unresponded first then responded
        const unrespKeys = [];
        const respKeys = [];
        for (const key of Object.keys(obj)) {
            const r = obj[key] || {};
            const responded = !!(r.responded || r.response);
            if (responded) respKeys.push(key); else unrespKeys.push(key);
        }
        const allKeys = unrespKeys.concat(respKeys);
        // apply status filter to ordering
        const filteredKeys = allKeys.filter(k => statusMatches(obj[k] || {}));
        if (n > filteredKeys.length) return {};
        const pick = filteredKeys[n - 1];
        if (!pick) return {};
        return { [pick]: obj[pick] };
    }

    // normal search + status filter
    const q = raw.toLowerCase();
    const numeric = isNumericString(q) ? q : null;
    const out = {};
    for (const key of Object.keys(obj)) {
        const r = obj[key] || {};
        if (!statusMatches(r)) continue;

        // decode message for accurate search
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

/* members filter unchanged (kept concise here) */
function filterMembersObject(obj, query, minGames, maxGames) {
    if (!obj) return {};
    const rawQuery = (query || "").trim();

    const lineMatch = rawQuery.match(/^\/\s*(\d+)\s*$/);
    if (lineMatch) {
        const n = parseInt(lineMatch[1], 10);
        if (!Number.isFinite(n) || n <= 0) return {};
        const allKeys = Object.keys(obj);
        if (n > allKeys.length) return {};
        const pickKey = allKeys[n - 1];

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

        const data = obj[pickKey];
        const gamesObj = data && data.Games ? data.Games : {};
        const count = Object.keys(gamesObj).length;
        if (count < min || count > max) return {};
        const o = {};
        o[pickKey] = data;
        return o;
    }

    const q = rawQuery.toLowerCase();
    const numericQuery = /^\d+$/.test(q) ? q : null;

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

    const out = {};
    for (const username of Object.keys(obj)) {
        const data = obj[username] || {};
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

// ---------- Rendering ----------
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

    // decode message and response for display, then escape for HTML
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

    // copy name/id handlers
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
        reportContainer.appendChild(numbered);
        idx++;
    }
}

// Member card functions kept the same (unchanged)
function createMemberCard(username, data, index = null) {
    const divCard = document.createElement("div");
    divCard.className = "member-card";

    const userId = (data && data.ID) ? data.ID : null;
    const avatarUrl = userId ? (`https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=100&height=100&format=Png`) : 'https://www.roblox.com/headshot-thumbnail/image?userId=1&width=100&height=100&format=Png';

    const gameCount = data && data.Games ? Object.keys(data.Games).length : 0;
    const gamesText = `Games: ${gameCount}`;

    divCard.innerHTML = `
        <img class="mavatar" src="${avatarUrl}" onerror="this.onerror=null;this.src='https://www.roblox.com/headshot-thumbnail/image?userId=1&width=100&height=100&format=Png'">
        <div class="mmeta">
            <div class="mname">${escapeHtml(username)}${userId ? ` • ${userId}` : ''}</div>
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
    memberContainer.innerHTML = "";
    if (!dataObj || Object.keys(dataObj).length === 0) {
        memberContainer.innerHTML = "<div class='loading'>Chưa có thành viên nào.</div>";
        return;
    }
    const keys = Object.keys(dataObj);
    let idx = 1;
    for (const username of keys) {
        const info = dataObj[username];
        const numbered = createMemberCard(username, info, idx);
        memberContainer.appendChild(numbered);
        idx++;
    }
}

// ---------- Member modal & game fetching (unchanged) ----------
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

// ---------- Load / delete / respond ----------
async function loadReports() {
    if (!reportContainer) return;
    reportContainer.innerHTML = "<div class='loading'>Đang tải dữ liệu...</div>";
    try {
        const res = await fetch(API_URL_REPORTS);
        if (!res.ok) throw new Error("Fetch failed");
        const json = await res.json();
        cachedReports = json || {};
        // ensure filter UI is bound
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
    const url = `${API_BASE_REPORTS}/${encodeURIComponent(playerName)}.json`;

    // encode responseText before sending
    const encodedResponse = encodeFirebaseMessage(responseText);

    const payload = {
        responded: true,
        response: encodedResponse,
        respondedAt: Date.now(),
        responseType: responseType
    };
    try {
        const res = await fetch(url, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error("respond failed");
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
    const url = `${API_BASE_REPORTS}/${encodeURIComponent(playerName)}.json`;
    try {
        const res = await fetch(url, { method: "DELETE" });
        if (!res.ok) throw new Error("delete failed");
        await quickRefreshCounts();
        await loadReports();
        return true;
    } catch (err) {
        console.error("removeReportCompletely error", err);
        return false;
    }
}

// cleanup responded older than 72h
async function cleanupOldResponded(reportsObj) {
    if (!reportsObj) return;
    const keys = Object.keys(reportsObj);
    const now = Date.now();
    for (const key of keys) {
        const r = reportsObj[key];
        if (!r) continue;
        const responded = !!(r.responded || r.response);
        if (!responded) continue;
        const respondedAt = Number(r.respondedAt || r.respondedAtMillis || r.respondedTimestamp || r.responded_ts || r.timestamp || 0);
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

// ---------- Members load ----------
async function loadMembers() {
    if (!memberContainer) return;
    memberContainer.innerHTML = "<div class='loading'>Đang tải danh sách thành viên...</div>";
    try {
        const res = await fetch(API_URL_MEMBER);
        if (!res.ok) throw new Error("Fetch failed");
        const json = await res.json();
        cachedMembers = json || {};
        const q = (searchMembersInput && searchMembersInput.value || "").trim();
        const minVal = (filterGamesMinInput && filterGamesMinInput.value || "").trim();
        const maxVal = (filterGamesMaxInput && filterGamesMaxInput.value || "").trim();
        const filtered = filterMembersObject(cachedMembers, q, minVal === "" ? null : minVal, maxVal === "" ? null : maxVal);
        await renderMembers(filtered);
        updateTabCounts(Object.keys(cachedReports || {}).length, Object.keys(cachedMembers).length);
    } catch (err) {
        memberContainer.innerHTML = "<div class='loading'>Lỗi tải dữ liệu thành viên.</div>";
        console.error(err);
    }
}

// ---------- counts & polling ----------
async function getReportsCount() {
    try {
        const res = await fetch(API_URL_REPORTS);
        if (!res.ok) return 0;
        const j = await res.json();
        if (!j) return 0;
        return Object.keys(j).length;
    } catch (e) { return 0; }
}
async function getMembersCount() {
    try {
        const res = await fetch(API_URL_MEMBER);
        if (!res.ok) return 0;
        const j = await res.json();
        if (!j) return 0;
        return Object.keys(j).length;
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

let reportsPollTimeout = null;
async function autoLoadReports(interval = 5000) {
    try {
        const res = await fetch(API_URL_REPORTS);
        if (res.ok) {
            const json = await res.json();
            if (JSON.stringify(json || {}) !== JSON.stringify(cachedReports || {})) {
                cachedReports = json || {};
                if (pageReports && pageReports.classList.contains("active")) {
                    const q = (searchReportsInput && searchReportsInput.value || "").trim();
                    const filtered = await filterReportsObject(cachedReports, q, currentReportFilter);
                    await renderReports(filtered);
                }
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
        const res = await fetch(API_URL_MEMBER);
        if (res.ok) {
            const json = await res.json();
            if (JSON.stringify(json || {}) !== JSON.stringify(cachedMembers || {})) {
                cachedMembers = json || {};
                if (pageMembers && pageMembers.classList.contains("active")) {
                    const q = (searchMembersInput && searchMembersInput.value || "").trim();
                    const minVal = (filterGamesMinInput && filterGamesMinInput.value || "").trim();
                    const maxVal = (filterGamesMaxInput && filterGamesMaxInput.value || "").trim();
                    const filtered = filterMembersObject(cachedMembers, q, minVal === "" ? null : minVal, maxVal === "" ? null : maxVal);
                    await renderMembers(filtered);
                }
            }
        }
    } catch (err) {
        console.error("Members auto load error:", err);
    } finally {
        membersPollTimeout = setTimeout(() => autoLoadMembers(interval), interval);
    }
}

// ---------- popup ----------
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

// ---------- Reply modal ----------
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

// ---------- Event wiring & search handlers ----------
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
    const filtered = filterMembersObject(cachedMembers || {}, q, minVal === "" ? null : minVal, maxVal === "" ? null : maxVal);
    await renderMembers(filtered);
    if (membersCountEl) membersCountEl.textContent = Object.keys(filtered || {}).length + " member(s)";
}, 300);

searchReportsInput && searchReportsInput.addEventListener("input", onSearchReports);
searchMembersInput && searchMembersInput.addEventListener("input", onSearchMembers);

// Helper: apply search + currentReportFilter and render
async function filterAndRenderReports(q) {
    const filtered = await filterReportsObject(cachedReports || {}, q, currentReportFilter);
    await renderReports(filtered);
    if (reportsCountEl) reportsCountEl.textContent = Object.keys(filtered || {}).length + " result(s)";
}

// ---------- Reports filter binding (robust) ----------
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

        // update active class
        const allBtns = reportsFilterEl.querySelectorAll(".filter-btn");
        allBtns.forEach(b => b.classList.toggle("active", b === btn));

        // re-render using current search
        const q = (searchReportsInput && searchReportsInput.value || "").trim();
        filterAndRenderReports(q);
    });

    // if initial active class set in HTML, sync currentReportFilter with it
    const initialActive = reportsFilterEl.querySelector(".filter-btn.active");
    if (initialActive) {
        const init = initialActive.getAttribute("data-filter");
        if (init) currentReportFilter = init;
    }

    reportsFilterBound = true;
}

// try immediate bind and also bind on DOMContentLoaded
bindReportsFilter();
document.addEventListener("DOMContentLoaded", bindReportsFilter);

// filter apply/clear for members
applyFilterBtn && applyFilterBtn.addEventListener("click", async () => {
    const q = (searchMembersInput && searchMembersInput.value || "").trim();
    const minVal = (filterGamesMinInput && filterGamesMinInput.value || "").trim();
    const maxVal = (filterGamesMaxInput && filterGamesMaxInput.value || "").trim();
    const filtered = filterMembersObject(cachedMembers || {}, q, minVal === "" ? null : minVal, maxVal === "" ? null : maxVal);
    await renderMembers(filtered);
    if (membersCountEl) membersCountEl.textContent = Object.keys(filtered || {}).length + " member(s)";
});
clearFilterBtn && clearFilterBtn.addEventListener("click", async () => {
    if (filterGamesMinInput) filterGamesMinInput.value = "";
    if (filterGamesMaxInput) filterGamesMaxInput.value = "";
    if (searchMembersInput) searchMembersInput.value = "";
    await loadMembers();
});

// ---------- initial ----------
(async function init() {
    startCountsPolling(7000);
    await quickRefreshCounts();
    await loadReports();
    autoLoadReports(5000);
    autoLoadMembers(12000);
})();

// ===== Scroll To Top Button =====
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
