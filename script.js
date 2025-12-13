// script.js (update: min/max games range filter)

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

// Member modal elements
const memberModal = document.getElementById("member-modal");
const memberModalClose = document.getElementById("member-modal-close");
const memberModalClose2 = document.getElementById("member-modal-close-2");
const memberAvatarEl = document.getElementById("member-avatar");
const memberUsernameEl = document.getElementById("member-username");
const memberUseridEl = document.getElementById("member-userid");
const memberGamecountEl = document.getElementById("member-gamecount");
const gameListEl = document.getElementById("game-list");

let selectedPlayer = null;
let cachedReports = null;
let cachedMembers = null;
const avatarPromiseCache = {};

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
    btnReports.textContent = reportsCount && reportsCount > 0 ? `Reports (${reportsCount})` : "Reports";
    btnMembers.textContent = membersCount && membersCount > 0 ? `Members (${membersCount})` : "Members";
    reportsCountEl.textContent = reportsCount ? `${reportsCount} result(s)` : "";
    membersCountEl.textContent = membersCount ? `${membersCount} member(s)` : "";
}
function showPage(page) {
    if (page === "reports") {
        btnReports.classList.add("active");
        btnMembers.classList.remove("active");
        pageReports.classList.add("active");
        pageMembers.classList.remove("active");
    } else {
        btnMembers.classList.add("active");
        btnReports.classList.remove("active");
        pageMembers.classList.add("active");
        pageReports.classList.remove("active");
    }
}

// ---------- Filtering/Search logic ----------

function isNumericString(s) {
    return /^\d+$/.test(String(s).trim());
}

// Filter reports object by query string (username, userId, message)
async function filterReportsObject(obj, query) {
    if (!query || !obj) return obj;
    const q = query.trim().toLowerCase();
    const numeric = isNumericString(q) ? q : null;

    const out = {};
    for (const key of Object.keys(obj)) {
        const r = obj[key] || {};
        const msg = (r.message || "").toString().toLowerCase();
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

/*
  Filter members object by:
    - query (username, userId, game name, placeId)
    - minGames, maxGames (both strings/input). Behavior:
      empty min -> -Infinity, empty max -> +Infinity
      non-numeric inputs are ignored (treated as empty)
      if min > max -> swap
*/
function filterMembersObject(obj, query, minGames, maxGames) {
    if (!obj) return obj;
    const q = (query || "").trim().toLowerCase();
    const numericQuery = isNumericString(q) ? q : null;

    // parse min/max
    let min = Number.NEGATIVE_INFINITY;
    let max = Number.POSITIVE_INFINITY;
    if (minGames !== null && minGames !== undefined && String(minGames).trim() !== "") {
        const v = parseInt(String(minGames).trim(), 10);
        if (!Number.isNaN(v)) min = v;
    }
    if (maxGames !== null && maxGames !== undefined && String(maxGames).trim() !== "") {
        const v = parseInt(String(maxGames).trim(), 10);
        if (!Number.isNaN(v)) max = v;
    }
    // swap if user accidentally provided min>max
    if (min > max) {
        const t = min; min = max; max = t;
    }

    const out = {};
    for (const username of Object.keys(obj)) {
        const data = obj[username] || {};
        const uid = data.ID ? String(data.ID) : "";
        const gamesObj = data.Games || {};
        const gameKeys = Object.keys(gamesObj);
        const count = gameKeys.length;

        // check games count in range
        if (count < min || count > max) continue;

        // if no query -> include
        if (!q) {
            out[username] = data;
            continue;
        }

        // match username or uid
        if (username.toLowerCase().includes(q) || uid.includes(q)) {
            out[username] = data;
            continue;
        }

        // match inside game keys (game name or id)
        let matched = false;
        for (const gk of gameKeys) {
            const gkl = gk.toLowerCase();
            if (gkl.includes(q)) { matched = true; break; }
            if (numericQuery) {
                const digits = gk.match(/(\d{4,})/g);
                if (digits && digits.join(" ").includes(numericQuery)) { matched = true; break; }
            }
        }
        if (matched) out[username] = data;
    }
    return out;
}

// ---------- Rendering with numbering ----------
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

// Create report/member cards (same as before)...
function createReportCard(playerKey, report, avatarUrl, userId, index = null) {
    const card = document.createElement("div");
    card.className = "card";

    const safeMessage = (report && report.message) ? escapeHtml(report.message) : "(Không có nội dung)";
    const tsText = report && report.timestamp ? formatDate(report.timestamp) : "";

    card.innerHTML = `
        <div class="top-section">
            <img class="avatar" src="${avatarUrl}" alt="avatar" onerror="this.onerror=null;this.src='https://www.roblox.com/headshot-thumbnail/image?userId=1&width=150&height=150&format=Png'">
            <div class="info">
                <div class="name">👤 ${escapeHtml(playerKey)}</div>
                <div class="userid">ID: ${userId || "Không tìm thấy"}</div>
            </div>
        </div>
        <div class="message">${safeMessage}</div>
        <div class="timestamp">⏱ ${tsText}</div>
    `;

    card.addEventListener("click", () => showConfirm(playerKey));

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

    if (index !== null) return makeNumberedRow(index, card);
    return card;
}

async function renderReports(dataObj) {
    reportContainer.innerHTML = "";
    if (!dataObj || Object.keys(dataObj).length === 0) {
        reportContainer.innerHTML = "<div class='loading'>Không có report nào.</div>";
        return;
    }
    const keys = Object.keys(dataObj);
    let idx = 1;
    for (const playerKey of keys) {
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
async function openMemberModal(username, memberData) {
    memberModal.classList.add("show");
    memberModal.setAttribute("aria-hidden", "false");

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
    memberModal.classList.remove("show");
    memberModal.setAttribute("aria-hidden", "true");
    gameListEl.innerHTML = "";
}
memberModalClose.addEventListener("click", closeMemberModal);
memberModalClose2.addEventListener("click", closeMemberModal);
memberModal.querySelector(".member-modal-overlay").addEventListener("click", closeMemberModal);

// ---------- Load / delete ----------
async function loadReports() {
    reportContainer.innerHTML = "<div class='loading'>Đang tải dữ liệu...</div>";
    try {
        const res = await fetch(API_URL_REPORTS);
        if (!res.ok) throw new Error("Fetch failed");
        const json = await res.json();
        cachedReports = json || {};
        const q = (searchReportsInput.value || "").trim();
        const filtered = await filterReportsObject(cachedReports, q);
        await renderReports(filtered);
        updateTabCounts(Object.keys(cachedReports).length, cachedMembers ? Object.keys(cachedMembers).length : 0);
    } catch (err) {
        reportContainer.innerHTML = "<div class='loading'>Lỗi tải dữ liệu.</div>";
        console.error(err);
    }
}
async function deleteReport(playerName) {
    const deleteURL = `${API_BASE_REPORTS}/${encodeURIComponent(playerName)}.json`;
    try {
        const res = await fetch(deleteURL, { method: "DELETE" });
        if (!res.ok) throw new Error("delete failed");
        await quickRefreshCounts();
        await loadReports();
    } catch (err) {
        alert("Không thể xóa report!");
        console.error(err);
    }
}

// ---------- Members load with search/filter ----------
async function loadMembers() {
    memberContainer.innerHTML = "<div class='loading'>Đang tải danh sách thành viên...</div>";
    try {
        const res = await fetch(API_URL_MEMBER);
        if (!res.ok) throw new Error("Fetch failed");
        const json = await res.json();
        cachedMembers = json || {};
        const q = (searchMembersInput.value || "").trim();
        const minVal = (filterGamesMinInput.value || "").trim();
        const maxVal = (filterGamesMaxInput.value || "").trim();
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

// auto-update small
let reportsPollTimeout = null;
async function autoLoadReports(interval = 5000) {
    try {
        const res = await fetch(API_URL_REPORTS);
        if (res.ok) {
            const json = await res.json();
            if (JSON.stringify(json || {}) !== JSON.stringify(cachedReports || {})) {
                cachedReports = json || {};
                if (pageReports.classList.contains("active")) {
                    const q = (searchReportsInput.value || "").trim();
                    const filtered = await filterReportsObject(cachedReports, q);
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
                if (pageMembers.classList.contains("active")) {
                    const q = (searchMembersInput.value || "").trim();
                    const minVal = (filterGamesMinInput.value || "").trim();
                    const maxVal = (filterGamesMaxInput.value || "").trim();
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
function showConfirm(playerName) { selectedPlayer = playerName; popup.classList.add("show"); }
function hideConfirm() { selectedPlayer = null; popup.classList.remove("show"); }
confirmYes.addEventListener("click", () => { if (selectedPlayer) { deleteReport(selectedPlayer); hideConfirm(); }});
confirmNo.addEventListener("click", hideConfirm);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideConfirm(); });

// ---------- Event wiring & search handlers ----------
reloadBtn.addEventListener("click", async () => {
    if (pageReports.classList.contains("active")) {
        await loadReports();
    } else {
        await loadMembers();
    }
    await quickRefreshCounts();
});
btnReports.addEventListener("click", async () => {
    showPage("reports");
    if (!cachedReports) await loadReports();
});
btnMembers.addEventListener("click", async () => {
    showPage("members");
    if (!cachedMembers) await loadMembers();
});

// search handlers (debounced)
const onSearchReports = debounce(async () => {
    const q = (searchReportsInput.value || "").trim();
    const filtered = await filterReportsObject(cachedReports || {}, q);
    await renderReports(filtered);
    reportsCountEl.textContent = Object.keys(filtered || {}).length + " result(s)";
}, 300);

const onSearchMembers = debounce(async () => {
    const q = (searchMembersInput.value || "").trim();
    const minVal = (filterGamesMinInput.value || "").trim();
    const maxVal = (filterGamesMaxInput.value || "").trim();
    const filtered = filterMembersObject(cachedMembers || {}, q, minVal === "" ? null : minVal, maxVal === "" ? null : maxVal);
    await renderMembers(filtered);
    membersCountEl.textContent = Object.keys(filtered || {}).length + " member(s)";
}, 300);

searchReportsInput.addEventListener("input", onSearchReports);
searchMembersInput.addEventListener("input", onSearchMembers);

// filter apply/clear
applyFilterBtn.addEventListener("click", async () => {
    const q = (searchMembersInput.value || "").trim();
    const minVal = (filterGamesMinInput.value || "").trim();
    const maxVal = (filterGamesMaxInput.value || "").trim();
    const filtered = filterMembersObject(cachedMembers || {}, q, minVal === "" ? null : minVal, maxVal === "" ? null : maxVal);
    await renderMembers(filtered);
    membersCountEl.textContent = Object.keys(filtered || {}).length + " member(s)";
});
clearFilterBtn.addEventListener("click", async () => {
    filterGamesMinInput.value = "";
    filterGamesMaxInput.value = "";
    searchMembersInput.value = "";
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
