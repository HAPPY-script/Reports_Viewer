const API_BASE = "https://happy-script-bada6-default-rtdb.asia-southeast1.firebasedatabase.app/reports";
const API_URL = API_BASE + ".json";

const container = document.getElementById("report-container");
const popup = document.getElementById("confirm-popup");
const confirmYes = document.getElementById("confirm-yes");
const confirmNo = document.getElementById("confirm-no");

let selectedPlayer = null;

// Format timestamp
function formatDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleString();
}

// Get Roblox Avatar API
function getAvatarURL(userId) {
    return `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=true`;
}

// Delete report
async function deleteReport(playerName) {
    const deleteURL = `${API_BASE}/${playerName}.json`;
    try {
        await fetch(deleteURL, { method: "DELETE" });
        loadReports();
    } catch (err) {
        console.error("Delete failed:", err);
        alert("Không thể xóa report!");
    }
}

// Popup show
function showConfirm(playerName) {
    selectedPlayer = playerName;
    popup.classList.add("show");
}

// Hide popup
function hideConfirm() {
    selectedPlayer = null;
    popup.classList.remove("show");
}

// Render UI
function renderReports(data) {
    container.innerHTML = "";

    if (!data) {
        container.innerHTML = "<div class='loading'>Không có report nào.</div>";
        return;
    }

    Object.keys(data).forEach(key => {
        const report = data[key];
        const userId = report.userId || 0;
        const avatarURL = getAvatarURL(userId);

        const card = document.createElement("div");
        card.className = "card";

        card.innerHTML = `
            <div class="top-section">
                <img src="${avatarURL}" class="avatar">
                <div class="info">
                    <div class="name">👤 ${report.playerName || key}</div>
                    <div class="userid">ID: ${userId}</div>
                </div>
            </div>

            <div class="message">${report.message || "(Không có nội dung)"}</div>

            <div class="timestamp">⏱ ${formatDate(report.timestamp)}</div>
        `;

        card.addEventListener("click", () => showConfirm(key));
        container.appendChild(card);
    });
}

// Fetch
async function loadReports() {
    container.innerHTML = "<div class='loading'>Đang tải dữ liệu...</div>";

    try {
        const res = await fetch(API_URL);
        const json = await res.json();
        renderReports(json);
    } catch (err) {
        container.innerHTML = "<div class='loading'>Lỗi tải dữ liệu.</div>";
        console.error(err);
    }
}

confirmYes.addEventListener("click", () => {
    if (selectedPlayer) deleteReport(selectedPlayer);
    hideConfirm();
});

confirmNo.addEventListener("click", hideConfirm);

document.addEventListener("keydown", e => {
    if (e.key === "Escape") hideConfirm();
});

setInterval(loadReports, 10000);
loadReports();
