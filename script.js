const API_BASE = "https://happy-script-bada6-default-rtdb.asia-southeast1.firebasedatabase.app/reports";
const API_URL = API_BASE + ".json";

const container = document.getElementById("report-container");
const popup = document.getElementById("confirm-popup");
const confirmYes = document.getElementById("confirm-yes");
const confirmNo = document.getElementById("confirm-no");

let selectedPlayer = null;
const avatarCache = {}; // cache userId -> avatarUrl

// Format timestamp (nhớ Lua lưu ms: os.time()*1000)
function formatDate(ts) {
    if (!ts) return "";
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString();
}

// Nếu cần tìm userId từ username (backup only)
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

// Trả về URL ảnh avatar headshot trực tiếp (kết quả là hình, không phải JSON)
function headshotImageUrl(userId, size = 150) {
    return `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=${size}&height=${size}&format=Png`;
}

// Xóa report
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

// Popup
function showConfirm(playerName) {
    selectedPlayer = playerName;
    popup.classList.add("show");
}
function hideConfirm() {
    selectedPlayer = null;
    popup.classList.remove("show");
}

// Tạo thẻ card cho 1 report
function createCard(playerKey, report, avatarUrl, userId) {
    const card = document.createElement("div");
    card.className = "card";

    const safeMessage = (report && report.message) ? escapeHtml(report.message) : "(Không có nội dung)";
    const tsText = report && report.timestamp ? formatDate(report.timestamp) : "";

    card.innerHTML = `
        <div class="top-section">
            <img class="avatar" src="${avatarUrl}" alt="avatar" onerror="this.src='https://www.roblox.com/headshot-thumbnail/image?userId=1&width=150&height=150&format=Png'">
            <div class="info">
                <div class="name">👤 ${escapeHtml(playerKey)}</div>
                <div class="userid">ID: ${userId || "Không tìm thấy"}</div>
            </div>
        </div>
        <div class="message">${safeMessage}</div>
        <div class="timestamp">⏱ ${tsText}</div>
    `;

    card.addEventListener("click", () => showConfirm(playerKey));
    return card;
}

// escape HTML để tránh XSS (dù dữ liệu từ Firebase không mong đợi HTML)
function escapeHtml(unsafe) {
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Render tất cả reports
async function renderReports(data) {
    container.innerHTML = "";

    if (!data || Object.keys(data).length === 0) {
        container.innerHTML = "<div class='loading'>Không có report nào.</div>";
        return;
    }

    // Duyệt từng report
    const keys = Object.keys(data);
    for (const playerKey of keys) {
        const report = data[playerKey];

        // Nếu Firebase đã lưu userId trong object report => dùng luôn
        let userId = (report && report.userId) ? report.userId : null;

        // Nếu không có userId trong report thì thử tìm theo username (chỉ làm khi cần)
        if (!userId) {
            // để tránh gọi API quá nhiều lần, chỉ gọi khi bắt buộc
            userId = await getUserIdFromUsername(playerKey);
        }

        // Lấy avatar URL (dùng cache nếu có)
        let avatarUrl = null;
        if (userId) {
            if (avatarCache[userId]) {
                avatarUrl = avatarCache[userId];
            } else {
                avatarUrl = headshotImageUrl(userId, 150);
                avatarCache[userId] = avatarUrl;
            }
        } else {
            // fallback generic avatar (roblox userId=1)
            avatarUrl = 'https://www.roblox.com/headshot-thumbnail/image?userId=1&width=150&height=150&format=Png';
        }

        const card = createCard(playerKey, report, avatarUrl, userId);
        container.appendChild(card);
    }
}

// Fetch reports
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

// Popup buttons
confirmYes.addEventListener("click", () => {
    if (selectedPlayer) {
        deleteReport(selectedPlayer);
        hideConfirm();
    }
});
confirmNo.addEventListener("click", hideConfirm);

// ESC để tắt popup
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideConfirm();
});

// Tự refresh mỗi 10 giây
setInterval(loadReports, 10000);

// Load ban đầu
loadReports();
