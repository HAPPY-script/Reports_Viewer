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

// Lấy UserID từ username
async function getUserId(username) {
    try {
        const res = await fetch(`https://api.roblox.com/users/get-by-username?username=${username}`);
        const json = await res.json();
        if (json && json.Id) return json.Id;
        return null;
    } catch {
        return null;
    }
}

// Lấy Avatar từ UserID (tròn)
function getAvatarUrl(userId) {
    return `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=150&height=150&format=Png`;
}

// Xóa report
async function deleteReport(playerName) {
    const deleteURL = `${API_BASE}/${playerName}.json`;
    try {
        await fetch(deleteURL, { method: "DELETE" });
        loadReports();
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

// Render reports
async function renderReports(data) {
    container.innerHTML = "";

    if (!data) {
        container.innerHTML = "<div class='loading'>Không có report nào.</div>";
        return;
    }

    for (const playerName of Object.keys(data)) {
        const report = data[playerName];
        const userId = await getUserId(playerName);
        const avatarUrl = userId ? getAvatarUrl(userId) : "";

        const card = document.createElement("div");
        card.className = "card";

        card.innerHTML = `
            <div class="top-section">
                <img class="avatar" src="${avatarUrl}" alt="avatar">
                <div class="info">
                    <div class="name">👤 ${playerName}</div>
                    <div class="userid">ID: ${userId || "Không tìm thấy"}</div>
                </div>
            </div>
            <div class="message">${report.message || "(Không có nội dung)"}</div>
            <div class="timestamp">⏱ ${formatDate(report.timestamp || null)}</div>
        `;

        card.addEventListener("click", () => showConfirm(playerName));
        container.appendChild(card);
    }
}

// Load reports
async function loadReports() {
    container.innerHTML = "<div class='loading'>Đang tải dữ liệu...</div>";
    try {
        const res = await fetch(API_URL);
        const json = await res.json();
        renderReports(json);
    } catch {
        container.innerHTML = "<div class='loading'>Lỗi tải dữ liệu.</div>";
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

// ESC để đóng popup
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideConfirm();
});

// Refresh mỗi 10 giây
setInterval(loadReports, 10000);

// Load ban đầu
loadReports();
