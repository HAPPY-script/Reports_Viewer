const API_BASE = "https://happy-script-bada6-default-rtdb.asia-southeast1.firebasedatabase.app/reports";
const API_URL = API_BASE + ".json";

const container = document.getElementById("report-container");
const popup = document.getElementById("confirm-popup");
const confirmYes = document.getElementById("confirm-yes");
const confirmNo = document.getElementById("confirm-no");

let selectedPlayer = null; // player đang chọn để xóa

// Format timestamp
function formatDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleString();
}

// Xóa report của player
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

// Hiện popup xác nhận
function showConfirm(playerName) {
    selectedPlayer = playerName;
    popup.classList.add("show");
}

// Ẩn popup
function hideConfirm() {
    selectedPlayer = null;
    popup.classList.remove("show");
}

// Render reports
function renderReports(data) {
    container.innerHTML = ""; 

    if (!data) {
        container.innerHTML = "<div class='loading'>Không có report nào.</div>";
        return;
    }

    Object.keys(data).forEach(playerName => {
        const report = data[playerName];

        const card = document.createElement("div");
        card.className = "card";

        card.innerHTML = `
            <div class="name">👤 ${playerName}</div>
            <div class="message">${report.message || "(Không có nội dung)"}</div>
            <div class="timestamp">⏱ ${formatDate(report.timestamp || null)}</div>
        `;

        card.addEventListener("click", () => showConfirm(playerName));

        container.appendChild(card);
    });
}

// Fetch reports
async function loadReports() {
    container.innerHTML = "<div class='loading'>Đang tải dữ liệu...</div>";

    try {
        const res = await fetch(API_URL);
        const json = await res.json();

        renderReports(json);
    } catch (error) {
        container.innerHTML = "<div class='loading'>Lỗi tải dữ liệu.</div>";
        console.error(error);
    }
}

// Popup button events
confirmYes.addEventListener("click", () => {
    if (selectedPlayer) {
        deleteReport(selectedPlayer);
        hideConfirm();
    }
});

confirmNo.addEventListener("click", hideConfirm);

// Esc key để hủy popup
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideConfirm();
});

// Refresh mỗi 10 giây
setInterval(loadReports, 10000);

// Load ban đầu
loadReports();
