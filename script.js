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

// Lấy avatar Roblox từ UserID
async function getAvatar(userId) {
    try {
        const res = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=true`);
        const json = await res.json();
        return json.data && json.data[0] ? json.data[0].imageUrl : "";
    } catch {
        return "";
    }
}

// Lấy UserID từ Username
async function getUserId(username) {
    try {
        const res = await fetch(`https://api.roblox.com/users/get-by-username?username=${username}`);
        const json = await res.json();
        return json.Id || null;
    } catch {
        return null;
    }
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
        const avatarUrl = userId ? await getAvatar(userId) : "";
        
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

// Fetch reports
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

// ESC để tắt popup
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideConfirm();
});

// Tự refresh mỗi 10 giây
setInterval(loadReports, 10000);

// Load ban đầu
loadReports();
