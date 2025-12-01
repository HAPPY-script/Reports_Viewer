const API_URL = "https://happy-script-bada6-default-rtdb.asia-southeast1.firebasedatabase.app/reports.json";

const container = document.getElementById("report-container");

// Format timestamp
function formatDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleString();
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

// Refresh mỗi 10 giây
setInterval(loadReports, 10000);

// Load ban đầu
loadReports();
