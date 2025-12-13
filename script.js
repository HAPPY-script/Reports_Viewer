// script.js - upgraded for Reports + Members + counts + transitions

const API_BASE_REPORTS = "https://happy-script-bada6-default-rtdb.asia-southeast1.firebasedatabase.app/reports";
const API_URL_REPORTS = API_BASE_REPORTS + ".json";

const API_BASE_MEMBER = "https://happy-script-bada6-default-rtdb.asia-southeast1.firebasedatabase.app/Member";
const API_URL_MEMBER = API_BASE_MEMBER + ".json";

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
        if (json && json.data && json.data.length > 0) {
            return json.data[0].id;
        }
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

// ---------- UI helpers ----------
function updateTabCounts(reportsCount, membersCount) {
    btnReports.textContent = reportsCount && reportsCount > 0 ? `Reports (${reportsCount})` : "Reports";
    btnMembers.textContent = membersCount && membersCount > 0 ? `Members (${membersCount})` : "Members";
}

// switch view with CSS classes
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

// ---------- Render Reports ----------
function createReportCard(playerKey, report, avatarUrl, userId) {
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

    // click to confirm delete
    card.addEventListener("click", () => showConfirm(playerKey));

    // copy name
    const nameEl = card.querySelector(".name");
    if (nameEl) {
        nameEl.style.cursor = "pointer";
        nameEl.title = "Click để copy tên";
        nameEl.addEventListener("click", (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(playerKey).then(()=>alert(`Đã copy tên: ${playerKey}`)).catch(()=>alert("Copy thất bại"));
        });
    }
    // copy id
    const idEl = card.querySelector(".userid");
    if (idEl && userId) {
        idEl.style.cursor = "pointer";
        idEl.title = "Click để copy ID";
        idEl.addEventListener("click", (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(userId.toString()).then(()=>alert(`Đã copy ID: ${userId}`)).catch(()=>alert("Copy thất bại"));
        });
    }
    return card;
}

async function renderReports(data) {
    reportContainer.innerHTML = "";
    if (!data || Object.keys(data).length === 0) {
        reportContainer.innerHTML = "<div class='loading'>Không có report nào.</div>";
        return;
    }

    const keys = Object.keys(data);
    // iterate in insertion order
    for (const playerKey of keys) {
        const report = data[playerKey];
        let userId = (report && report.userId) ? report.userId : null;
        if (!userId) userId = await getUserIdFromUsername(playerKey);
        let avatarUrl = 'https://www.roblox.com/headshot-thumbnail/image?userId=1&width=150&height=150&format=Png';
        if (userId) {
            try {
                const url = await fetchAvatarImageUrl(userId, "150x150");
                if (url) avatarUrl = url;
            } catch (e) {}
        }
        const card = createReportCard(playerKey, report, avatarUrl, userId);
        reportContainer.appendChild(card);
    }
}

// ---------- Load Reports ----------
async function loadReports() {
    reportContainer.innerHTML = "<div class='loading'>Đang tải dữ liệu...</div>";
    try {
        const res = await fetch(API_URL_REPORTS);
        if (!res.ok) throw new Error("Fetch failed");
        const json = await res.json();
        cachedReports = json;
        await renderReports(json);
    } catch (err) {
        reportContainer.innerHTML = "<div class='loading'>Lỗi tải dữ liệu.</div>";
        console.error(err);
    }
}

// ---------- Delete report ----------
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

// ---------- Popup ----------
function showConfirm(playerName) {
    selectedPlayer = playerName;
    popup.classList.add("show");
}
function hideConfirm() {
    selectedPlayer = null;
    popup.classList.remove("show");
}
confirmYes.addEventListener("click", () => {
    if (selectedPlayer) {
        deleteReport(selectedPlayer);
        hideConfirm();
    }
});
confirmNo.addEventListener("click", hideConfirm);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideConfirm(); });

// ---------- Members rendering ----------
function createMemberCard(username, data) {
    const div = document.createElement("div");
    div.className = "member-card";

    const userId = (data && data.ID) ? data.ID : null;
    const avatarUrl = userId ? (`https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=100&height=100&format=Png`) : 'https://www.roblox.com/headshot-thumbnail/image?userId=1&width=100&height=100&format=Png';

    const gameCount = data && data.Games ? Object.keys(data.Games).length : 0;
    const gamesText = `Games: ${gameCount}`;

    div.innerHTML = `
        <img class="mavatar" src="${avatarUrl}" onerror="this.onerror=null;this.src='https://www.roblox.com/headshot-thumbnail/image?userId=1&width=100&height=100&format=Png'">
        <div class="mmeta">
            <div class="mname">${escapeHtml(username)}${userId ? ` • ${userId}` : ''}</div>
            <div class="mgames">${escapeHtml(gamesText)}</div>
        </div>
    `;

    // allow copy username/id
    div.querySelector(".mname").style.cursor = "pointer";
    div.querySelector(".mname").title = "Click để copy tên/ID";
    div.querySelector(".mname").addEventListener("click", () => {
        const toCopy = userId ? `${username} (${userId})` : username;
        navigator.clipboard.writeText(toCopy).then(()=>alert(`Đã copy: ${toCopy}`)).catch(()=>alert("Copy thất bại"));
    });

    return div;
}

async function renderMembers(data) {
    memberContainer.innerHTML = "";
    if (!data || Object.keys(data).length === 0) {
        memberContainer.innerHTML = "<div class='loading'>Chưa có thành viên nào.</div>";
        return;
    }
    const keys = Object.keys(data);
    // show each member
    for (const username of keys) {
        const info = data[username];
        const card = createMemberCard(username, info);
        memberContainer.appendChild(card);
    }
}

// ---------- Load Members ----------
async function loadMembers() {
    memberContainer.innerHTML = "<div class='loading'>Đang tải danh sách thành viên...</div>";
    try {
        const res = await fetch(API_URL_MEMBER);
        if (!res.ok) throw new Error("Fetch failed");
        const json = await res.json();
        cachedMembers = json;
        await renderMembers(json);
    } catch (err) {
        memberContainer.innerHTML = "<div class='loading'>Lỗi tải dữ liệu thành viên.</div>";
        console.error(err);
    }
}

// ---------- Counts & auto-polling ----------
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

// periodical auto-check (only checks counts quickly to update badges)
let countsIntervalHandle = null;
function startCountsPolling(interval = 7000) {
    quickRefreshCounts();
    if (countsIntervalHandle) clearInterval(countsIntervalHandle);
    countsIntervalHandle = setInterval(quickRefreshCounts, interval);
}

// ---------- auto load full reports if changes (like before) ----------
let reportsPollTimeout = null;
async function autoLoadReports(interval = 5000) {
    try {
        const res = await fetch(API_URL_REPORTS);
        if (res.ok) {
            const json = await res.json();
            // if changed, re-render and update cached
            if (JSON.stringify(json) !== JSON.stringify(cachedReports)) {
                cachedReports = json;
                // if user currently sees reports page -> render
                if (pageReports.classList.contains("active")) await renderReports(json);
            }
        }
    } catch (err) {
        console.error("Auto load error:", err);
    } finally {
        reportsPollTimeout = setTimeout(() => autoLoadReports(interval), interval);
    }
}

// ---------- auto load members less frequently ----------
let membersPollTimeout = null;
async function autoLoadMembers(interval = 12000) {
    try {
        const res = await fetch(API_URL_MEMBER);
        if (res.ok) {
            const json = await res.json();
            if (JSON.stringify(json) !== JSON.stringify(cachedMembers)) {
                cachedMembers = json;
                if (pageMembers.classList.contains("active")) await renderMembers(json);
            }
        }
    } catch (err) {
        console.error("Members auto load error:", err);
    } finally {
        membersPollTimeout = setTimeout(() => autoLoadMembers(interval), interval);
    }
}

// ---------- Event wiring ----------
reloadBtn.addEventListener("click", async () => {
    if (pageReports.classList.contains("active")) {
        await loadReports();
    } else {
        await loadMembers();
    }
    await quickRefreshCounts();
});

// Tab buttons
btnReports.addEventListener("click", async () => {
    showPage("reports");
    // ensure reports loaded
    if (!cachedReports) await loadReports();
});
btnMembers.addEventListener("click", async () => {
    showPage("members");
    // ensure members loaded
    if (!cachedMembers) await loadMembers();
});

// initial actions
(async function init() {
    // initial counts & load reports page by default
    startCountsPolling(7000);
    await quickRefreshCounts();

    // load reports content and start autos
    await loadReports();
    autoLoadReports(5000);
    autoLoadMembers(12000);
    // also auto refresh counts
    startCountsPolling(7000);
})();
