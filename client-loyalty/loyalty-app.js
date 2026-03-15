const API_BASE = "";
const GOOGLE_CLIENT_ID = "580542734412-01e4igcmvupjmihjm2tq9fk114r8m4oq.apps.googleusercontent.com";

let state = {
  screen: "loading",
  customer: null,
  token: null,
  loyaltyAccounts: [],
};

function saveSession() {
  if (state.customer && state.token) {
    localStorage.setItem("loyalty_session", JSON.stringify({
      customer: state.customer,
      token: state.token,
    }));
  }
}

function loadSession() {
  try {
    const saved = localStorage.getItem("loyalty_session");
    if (saved) {
      const { customer, token } = JSON.parse(saved);
      state.customer = customer;
      state.token = token;
      return true;
    }
  } catch (e) {}
  return false;
}

function clearSession() {
  localStorage.removeItem("loyalty_session");
  state.customer = null;
  state.token = null;
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}/api/loyalty${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Loyalty-Token": state.token || "",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Error ${res.status}`);
  }
  return res.json();
}

async function apiGet(path, extraHeaders = {}) {
  const res = await fetch(`${API_BASE}/api/loyalty${path}`, {
    headers: {
      "X-Loyalty-Token": state.token || "",
      ...extraHeaders,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Error ${res.status}`);
  }
  return res.json();
}

function render(html) {
  document.getElementById("app").innerHTML = html;
}

function showLoading(msg = "Cargando...") {
  render(`
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:16px;animation:fadeIn 0.3s ease;">
      <div style="width:48px;height:48px;border:3px solid #1e1e30;border-top-color:#6c63ff;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
      <p style="color:#666;font-size:14px;">${msg}</p>
    </div>
  `);
}

function showError(msg) {
  render(`
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:16px;padding:24px;animation:fadeIn 0.3s ease;">
      <div style="font-size:48px;">⚠️</div>
      <p style="color:#f87171;text-align:center;font-size:15px;">${msg}</p>
      <button onclick="init()" style="padding:12px 24px;background:#6c63ff;color:white;border:none;border-radius:10px;cursor:pointer;font-size:15px;font-weight:600;font-family:inherit;">
        Reintentar
      </button>
    </div>
  `);
}

function initGoogleSignIn() {
  if (!window.google) return;
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    auto_select: false,
    cancel_on_tap_outside: true,
    ux_mode: "redirect",
    login_uri: "https://loyalty.rmscore.app/auth/google-callback",
  });
}

async function loadHomeData() {
  try {
    const accounts = await apiGet(`/customers/${state.customer.id}/accounts`);
    state.loyaltyAccounts = accounts;
  } catch (e) {
    state.loyaltyAccounts = [];
  }
}

function renderLogin() {
  state.screen = "login";
  render(`
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:32px;gap:36px;animation:fadeIn 0.4s ease;">
      <div style="text-align:center;">
        <div style="width:80px;height:80px;background:linear-gradient(135deg,#6c63ff,#4f46e5);border-radius:24px;display:flex;align-items:center;justify-content:center;font-size:40px;margin:0 auto 20px;box-shadow:0 8px 32px rgba(108,99,255,0.3);">🏆</div>
        <h1 style="font-size:28px;font-weight:800;color:#e8e8f0;margin-bottom:8px;letter-spacing:-0.5px;">RMSCore Loyalty</h1>
        <p style="color:#666;font-size:16px;line-height:1.5;">Acumula puntos en tus<br>restaurantes favoritos</p>
      </div>
      <div style="width:100%;max-width:320px;display:flex;flex-direction:column;gap:20px;">
        <div style="background:#1a1a2e;border:1px solid #2a2a45;border-radius:16px;padding:20px;text-align:center;">
          <p style="color:#888;font-size:13px;margin-bottom:16px;line-height:1.5;">
            Inicia sesión con tu cuenta de Google para ver y acumular tus puntos
          </p>
          <div id="google-btn" style="display:flex;justify-content:center;min-height:44px;"></div>
        </div>
      </div>
      <p style="color:#444;font-size:12px;text-align:center;max-width:280px;line-height:1.6;">
        Al iniciar sesión aceptas los términos de servicio de RMSCore Loyalty
      </p>
    </div>
  `);

  const tryRenderBtn = () => {
    if (window.google && document.getElementById("google-btn")) {
      google.accounts.id.renderButton(
        document.getElementById("google-btn"),
        {
          theme: "filled_black",
          size: "large",
          width: 280,
          text: "continue_with",
          locale: "es",
          shape: "rectangular",
        }
      );
    }
  };

  setTimeout(tryRenderBtn, 100);
  setTimeout(tryRenderBtn, 500);
}

function renderHome() {
  state.screen = "home";
  const customer = state.customer;
  const totalPoints = state.loyaltyAccounts.reduce(
    (sum, a) => sum + parseFloat(a.points_balance || 0), 0
  );

  const accountsHtml = state.loyaltyAccounts.length === 0
    ? `<div style="text-align:center;color:#444;padding:40px 24px;background:#111120;border-radius:16px;border:1px dashed #2a2a40;">
        <div style="font-size:40px;margin-bottom:12px;">🍽️</div>
        <p style="font-size:15px;color:#666;line-height:1.6;">Aún no tienes puntos acumulados.<br><span style="color:#555;font-size:13px;">Visita un restaurante RMSCore y pide que vinculen tu cuenta al pagar.</span></p>
       </div>`
    : state.loyaltyAccounts.map(a => {
        const pts = parseInt(a.points_balance || 0);
        const lastVisit = a.last_visit
          ? new Date(a.last_visit).toLocaleDateString("es-CR", { day: "numeric", month: "short", year: "numeric" })
          : "—";
        return `
          <div onclick="loadRestaurantDetail(${a.tenant_id})"
               role="button"
               tabindex="0"
               style="background:#111120;border:1px solid #2a2a40;border-radius:16px;padding:18px;cursor:pointer;transition:all 0.15s;margin-bottom:10px;"
               onmouseenter="this.style.borderColor='#6c63ff';this.style.background='#14142a'"
               onmouseleave="this.style.borderColor='#2a2a40';this.style.background='#111120'">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
              <div style="flex:1;min-width:0;">
                <h3 style="font-size:16px;font-weight:700;color:#e8e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.business_name || "Restaurante RMSCore"}</h3>
                <p style="font-size:12px;color:#555;margin-top:4px;">Última visita: ${lastVisit}</p>
              </div>
              <div style="text-align:right;flex-shrink:0;">
                <div style="font-size:26px;font-weight:800;color:#6c63ff;line-height:1;">${pts.toLocaleString("es-CR")}</div>
                <div style="font-size:10px;color:#555;letter-spacing:0.05em;margin-top:2px;text-transform:uppercase;">puntos RMS</div>
              </div>
            </div>
          </div>`;
      }).join("");

  render(`
    <div style="min-height:100vh;background:#0f0f1a;animation:fadeIn 0.3s ease;">
      <div style="background:linear-gradient(160deg,#1a1a2e 0%,#13132a 100%);padding:48px 24px 28px;position:sticky;top:0;z-index:10;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
          ${customer.photo_url
            ? `<img src="${customer.photo_url}" alt="" onerror="this.outerHTML='<div style=\'width:44px;height:44px;border-radius:50%;background:#2a2a45;display:flex;align-items:center;justify-content:center;font-size:20px;\'>👤</div>'" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid #2a2a45;">`
            : `<div style="width:44px;height:44px;border-radius:50%;background:#2a2a45;display:flex;align-items:center;justify-content:center;font-size:20px;">👤</div>`
          }
          <div style="flex:1;min-width:0;">
            <p style="font-size:12px;color:#555;text-transform:uppercase;letter-spacing:0.08em;">Bienvenido,</p>
            <h2 style="font-size:17px;font-weight:700;color:#e8e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${customer.name}</h2>
          </div>
          <button onclick="logout()"
                  style="background:transparent;border:1px solid #2a2a40;color:#555;padding:7px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;transition:all 0.15s;"
                  onmouseenter="this.style.borderColor='#f87171';this.style.color='#f87171'"
                  onmouseleave="this.style.borderColor='#2a2a40';this.style.color='#555'">
            Salir
          </button>
        </div>
        <div style="background:rgba(108,99,255,0.12);border:1px solid rgba(108,99,255,0.25);border-radius:20px;padding:24px;text-align:center;">
          <p style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">Total de puntos RMS</p>
          <div style="font-size:52px;font-weight:800;color:#6c63ff;line-height:1;letter-spacing:-1px;">${Math.floor(totalPoints).toLocaleString("es-CR")}</div>
          <p style="font-size:11px;color:#555;margin-top:8px;">válidos en todos los restaurantes RMSCore</p>
        </div>
      </div>

      <div style="padding:24px;">
        <h3 style="font-size:11px;font-weight:700;color:#444;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:14px;">
          Mis restaurantes (${state.loyaltyAccounts.length})
        </h3>
        ${accountsHtml}
      </div>
    </div>
  `);
}

async function loadRestaurantDetail(tenantId) {
  showLoading("Cargando historial...");
  try {
    const data = await apiGet(`/customers/${state.customer.id}`, {
      "X-Tenant-Id": String(tenantId),
    });
    renderRestaurantDetail(data, tenantId);
  } catch (err) {
    showError("Error cargando historial: " + err.message);
  }
}

function renderRestaurantDetail(data, tenantId) {
  const { customer, account, events } = data;
  const points = account ? parseInt(parseFloat(account.points_balance)) : 0;

  const eventsHtml = (!events || events.length === 0)
    ? `<div style="text-align:center;color:#444;padding:32px;background:#111120;border-radius:16px;border:1px dashed #2a2a40;">
        <p style="font-size:14px;color:#555;">Sin transacciones registradas aún</p>
       </div>`
    : events.map(e => {
        const pts = parseFloat(e.points || 0);
        const date = e.created_at
          ? new Date(e.created_at).toLocaleDateString("es-CR", { day: "numeric", month: "short", year: "numeric" })
          : "—";
        const isEarn = pts > 0;
        return `
          <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:14px 0;border-bottom:1px solid #1a1a2e;gap:12px;">
            <div style="flex:1;min-width:0;">
              <p style="font-size:14px;color:#c8c8e0;line-height:1.4;">${e.description || (isEarn ? "Puntos acumulados" : "Redención de puntos")}</p>
              <p style="font-size:11px;color:#444;margin-top:4px;">${date}</p>
            </div>
            <div style="font-size:17px;font-weight:700;color:${isEarn ? '#4ade80' : '#f87171'};flex-shrink:0;padding-top:2px;">
              ${isEarn ? '+' : ''}${parseInt(pts).toLocaleString("es-CR")}
            </div>
          </div>`;
      }).join("");

  render(`
    <div style="min-height:100vh;background:#0f0f1a;animation:fadeIn 0.3s ease;">
      <div style="background:linear-gradient(160deg,#1a1a2e 0%,#13132a 100%);padding:48px 24px 24px;">
        <button onclick="goHome()"
                style="background:transparent;border:none;color:#6c63ff;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;padding:0;margin-bottom:16px;display:flex;align-items:center;gap:6px;"
                onmouseenter="this.style.color='#8b83ff'"
                onmouseleave="this.style.color='#6c63ff'">
          ← Volver
        </button>
        <h2 style="font-size:18px;font-weight:700;color:#e8e8f0;margin-bottom:20px;">Mis puntos aquí</h2>
        <div style="background:rgba(108,99,255,0.12);border:1px solid rgba(108,99,255,0.25);border-radius:20px;padding:24px;text-align:center;">
          <p style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">Puntos disponibles</p>
          <div style="font-size:52px;font-weight:800;color:#6c63ff;line-height:1;letter-spacing:-1px;">${points.toLocaleString("es-CR")}</div>
          <p style="font-size:11px;color:#555;margin-top:8px;">puntos RMS en este restaurante</p>
        </div>
      </div>
      <div style="padding:24px;">
        <h3 style="font-size:11px;font-weight:700;color:#444;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:16px;">
          Historial de transacciones
        </h3>
        ${eventsHtml}
      </div>
    </div>
  `);
}

async function goHome() {
  showLoading();
  await loadHomeData();
  renderHome();
}

function logout() {
  clearSession();
  if (window.google) {
    try { google.accounts.id.disableAutoSelect(); } catch (e) {}
  }
  state.loyaltyAccounts = [];
  renderLogin();
}

async function init() {
  showLoading();

  // Handle redirect back from Google OAuth
  const params = new URLSearchParams(window.location.search);
  const loginSuccess = params.get("login_success");
  const tokenParam = params.get("token");
  const customerParam = params.get("customer");
  const errorParam = params.get("error");

  if (errorParam) {
    window.history.replaceState({}, document.title, "/");
    showError("Error al iniciar sesión: " + decodeURIComponent(errorParam));
    setTimeout(renderLogin, 2000);
    return;
  }

  if (loginSuccess && tokenParam && customerParam) {
    try {
      state.token = tokenParam;
      state.customer = JSON.parse(decodeURIComponent(customerParam));
      saveSession();
      window.history.replaceState({}, document.title, "/");
      await loadHomeData();
      renderHome();
      return;
    } catch (e) {
      window.history.replaceState({}, document.title, "/");
    }
  }

  if (loadSession()) {
    try {
      await loadHomeData();
      renderHome();
      return;
    } catch (e) {
      clearSession();
    }
  }

  const tryInit = () => {
    initGoogleSignIn();
    renderLogin();
  };

  if (window.google) {
    tryInit();
  } else {
    window.addEventListener("load", tryInit);
    setTimeout(tryInit, 1500);
  }
}

window.init = init;
window.renderHome = renderHome;
window.goHome = goHome;
window.loadRestaurantDetail = loadRestaurantDetail;
window.logout = logout;

init();
