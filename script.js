// script.js
const API_BASE = "https://happy-script-bada6-default-rtdb.asia-southeast1.firebasedatabase.app/reports";
const API_URL = API_BASE + ".json";

const container = document.getElementById("report-container");
const popup = document.getElementById("confirm-popup");
const confirmYes = document.getElementById("confirm-yes");
const confirmNo = document.getElementById("confirm-no");
const reloadBtn = document.getElementById("reload-btn");

let selectedPlayer = null;

// cache: userId -> promise resolving to imageUrl (so we don't fetch same thumbnail twice)
const avatarPromiseCache = {};

// Format timestamp (Lua lưu ms: os.time()*1000)
function formatDate(ts) {
    if (!ts) return "";
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString();
}

// Escape HTML to avoid XSS
function escapeHtml(unsafe) {
    return String(unsafe || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Lấy userId từ username (backup)
async function getUserIdFromUsername(username) {
    try {
        const res = await fetch(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(username)}&limit=1`);
        if (!res.ok) return null;
        const json = await res.json();
        if (json && json.data && json.data.length > 0) {
            return json.data[0].id;
        }
        return null;
    } catch (e) {
        return null;
    }
}

// sửa fetchAvatarImageUrl: dùng roproxy.com
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
            if (d && d.imageUrl) {
                return d.imageUrl;
            } else {
                throw new Error("no imageUrl");
            }
        } catch (e) {
            // fallback generic / default avatar
            return `https://www.roblox.com/headshot-thumbnail/image?userId=1&width=150&height=150&format=Png`;
        }
    })();

    avatarPromiseCache[userId] = p;
    return p;
}

// Create a card element
// Create a card element
function createCard(playerKey, report, avatarUrl, userId) {
    const card = document.createElement("div");
    card.className = "card";

    const safeMessage = (report && report.message) ? escapeHtml(report.message) : "(Không có nội dung)";
    const tsText = report && report.timestamp ? formatDate(report.timestamp) : "";

    // Build inner HTML
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

    // Click card để show popup
    card.addEventListener("click", () => showConfirm(playerKey));

    // Copy name khi bấm
    const nameEl = card.querySelector(".name");
    if (nameEl) {
        nameEl.style.cursor = "pointer"; // hiển thị con trỏ tay
        nameEl.title = "Click để copy tên";
        nameEl.addEventListener("click", (e) => {
            e.stopPropagation(); // tránh trigger popup
            navigator.clipboard.writeText(playerKey)
                .then(() => alert(`Đã copy tên: ${playerKey}`))
                .catch(() => alert("Copy thất bại"));
        });
    }

    // Copy ID khi bấm
    const idEl = card.querySelector(".userid");
    if (idEl && userId) {
        idEl.style.cursor = "pointer";
        idEl.title = "Click để copy ID";
        idEl.addEventListener("click", (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(userId.toString())
                .then(() => alert(`Đã copy ID: ${userId}`))
                .catch(() => alert("Copy thất bại"));
        });
    }

    return card;
}

// Render reports (sử dụng avatarImageUrlResolved nếu có)
async function renderReports(data) {
    container.innerHTML = "";

    if (!data || Object.keys(data).length === 0) {
        container.innerHTML = "<div class='loading'>Không có report nào.</div>";
        return;
    }

    const keys = Object.keys(data);
    for (const playerKey of keys) {
        const report = data[playerKey];

        // userId có thể đã được lưu trong object (đúng như Lua gửi)
        let userId = (report && report.userId) ? report.userId : null;

        // nếu không có userId, try tìm theo username
        if (!userId) {
            userId = await getUserIdFromUsername(playerKey);
        }

        // lấy imageUrl chính xác bằng thumbnails API
        let avatarUrl = 'https://www.roblox.com/headshot-thumbnail/image?userId=1&width=150&height=150&format=Png'; // default
        if (userId) {
            try {
                const url = await fetchAvatarImageUrl(userId, "150x150");
                if (url) avatarUrl = url;
            } catch (e) {
                // ignore, fallback sẽ dùng default
            }
        }

        const card = createCard(playerKey, report, avatarUrl, userId);
        container.appendChild(card);
    }
}

// Load reports (khi người dùng bấm Reload)
async function loadReports() {
    container.innerHTML = "<div class='loading'>Đang tải dữ liệu...</div>";
    try {
        const res = await fetch(API_URL);
        if (!res.ok) throw new Error("Fetch failed");
        const json = await res.json();
        await renderReports(json);
    } catch (err) {
        container.innerHTML = "<div class='loading'>Lỗi tải dữ liệu.</div>";
        console.error(err);
    }
}

// Delete report
async function deleteReport(playerName) {
    const deleteURL = `${API_BASE}/${encodeURIComponent(playerName)}.json`;
    try {
        const res = await fetch(deleteURL, { method: "DELETE" });
        if (!res.ok) throw new Error("delete failed");
        await loadReports();
    } catch (err) {
        alert("Không thể xóa report!");
    }
}

// Popup controls
function showConfirm(playerName) {
    selectedPlayer = playerName;
    popup.classList.add("show");
}
function hideConfirm() {
    selectedPlayer = null;
    popup.classList.remove("show");
}

// Hook popup buttons
confirmYes.addEventListener("click", () => {
    if (selectedPlayer) {
        deleteReport(selectedPlayer);
        hideConfirm();
    }
});
confirmNo.addEventListener("click", hideConfirm);
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideConfirm();
});

// Reload button (người dùng phải bấm để load)
reloadBtn.addEventListener("click", () => {
    loadReports();
});
