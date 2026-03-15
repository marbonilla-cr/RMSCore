const API_BASE = "";
const GOOGLE_CLIENT_ID = "580542734412-01e4igcmvupjmihjm2tq9fk114r8m4oq.apps.googleusercontent.com";

let state = {
  screen: "loading",
  customer: null,
  token: null,
  tenantId: 0,
  loyaltyAccounts: [],
};

function saveSession() {
  if (state.customer && state.token) {
    localStorage.setItem("loyalty_session", JSON.stringify({
      customer: state.customer,
      token: state.token,
      tenantId: state.tenantId,
    }));
  }
}

function loadSession() {
  try {
    const saved = localStorage.getItem("loyalty_session");
    if (saved) {
      const { customer, token, tenantId } = JSON.parse(saved);
      state.customer = customer;
      state.token = token;
      state.tenantId = tenantId || 0;
      return true;
    }
  } catch (e) {}
  return false;
}

function clearSession() {
  localStorage.removeItem("loyalty_session");
  state.customer = null;
  state.token = null;
  state.tenantId = 0;
}

function loyaltyHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    "X-Loyalty-Token": state.token || "",
    "X-Tenant-Id": state.tenantId ? String(state.tenantId) : "",
    ...extra,
  };
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}/api/loyalty${path}`, {
    method: "POST",
    headers: loyaltyHeaders(),
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
    headers: loyaltyHeaders(extraHeaders),
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

function buildGoogleOAuthUrl() {
  const nonce = Math.random().toString(36).substring(2) + Date.now().toString(36);
  const params = new URLSearchParams({
    response_type: "id_token",
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: "https://loyalty.rmscore.app/auth/google-callback",
    scope: "openid email profile",
    nonce: nonce,
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
}

function loginWithGoogle() {
  window.location.href = buildGoogleOAuthUrl();
}
window.loginWithGoogle = loginWithGoogle;

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
            Inicia sesión para ver y acumular tus puntos
          </p>
          <button onclick="loginWithGoogle()" data-testid="button-google-login" style="display:flex;align-items:center;justify-content:center;gap:12px;width:100%;padding:12px 20px;background:#fff;color:#1f1f1f;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);margin-bottom:14px;">
            <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Continuar con Google
          </button>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
            <div style="flex:1;height:1px;background:#2a2a45;"></div>
            <span style="color:#555;font-size:12px;">o</span>
            <div style="flex:1;height:1px;background:#2a2a45;"></div>
          </div>
          <button onclick="showEmailForm()" data-testid="button-email-login" style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px 20px;background:transparent;color:#c8c8e0;border:1px solid #2a2a45;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;transition:border-color 0.15s;" onmouseenter="this.style.borderColor='#6c63ff'" onmouseleave="this.style.borderColor='#2a2a45'">
            ✉️ Continuar con correo
          </button>
        </div>
      </div>
      <p style="color:#444;font-size:12px;text-align:center;max-width:280px;line-height:1.6;">
        Al iniciar sesión aceptas los términos de servicio de RMSCore Loyalty
      </p>
    </div>
  `);

}

function showEmailForm() {
  state.screen = "email-form";
  render(`
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:32px;gap:24px;animation:fadeIn 0.3s ease;">
      <div style="text-align:center;">
        <div style="width:60px;height:60px;background:linear-gradient(135deg,#6c63ff,#4f46e5);border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 16px;box-shadow:0 6px 24px rgba(108,99,255,0.3);">✉️</div>
        <h1 style="font-size:22px;font-weight:800;color:#e8e8f0;margin-bottom:6px;">Crear cuenta</h1>
        <p style="color:#666;font-size:14px;">Ingresa tus datos para continuar</p>
      </div>
      <form id="email-register-form" onsubmit="submitEmailForm(event)" style="width:100%;max-width:320px;display:flex;flex-direction:column;gap:14px;">
        <div id="email-form-error" style="display:none;background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.3);border-radius:10px;padding:10px 14px;color:#f87171;font-size:13px;text-align:center;"></div>
        <div>
          <label style="display:block;color:#888;font-size:12px;margin-bottom:6px;font-weight:600;">Nombre completo *</label>
          <input id="reg-name" type="text" required autocomplete="name" data-testid="input-name" placeholder="Juan Pérez" style="width:100%;padding:12px 14px;background:#1a1a2e;border:1px solid #2a2a45;border-radius:10px;color:#e8e8f0;font-size:15px;font-family:inherit;outline:none;transition:border-color 0.15s;box-sizing:border-box;" onfocus="this.style.borderColor='#6c63ff'" onblur="this.style.borderColor='#2a2a45'">
        </div>
        <div>
          <label style="display:block;color:#888;font-size:12px;margin-bottom:6px;font-weight:600;">Correo electrónico *</label>
          <input id="reg-email" type="email" required autocomplete="email" data-testid="input-email" placeholder="juan@ejemplo.com" style="width:100%;padding:12px 14px;background:#1a1a2e;border:1px solid #2a2a45;border-radius:10px;color:#e8e8f0;font-size:15px;font-family:inherit;outline:none;transition:border-color 0.15s;box-sizing:border-box;" onfocus="this.style.borderColor='#6c63ff'" onblur="this.style.borderColor='#2a2a45'">
        </div>
        <div>
          <label style="display:block;color:#888;font-size:12px;margin-bottom:6px;font-weight:600;">Teléfono <span style="color:#555;font-weight:400;">(opcional)</span></label>
          <input id="reg-phone" type="tel" autocomplete="tel" data-testid="input-phone" placeholder="+506 8888-0000" style="width:100%;padding:12px 14px;background:#1a1a2e;border:1px solid #2a2a45;border-radius:10px;color:#e8e8f0;font-size:15px;font-family:inherit;outline:none;transition:border-color 0.15s;box-sizing:border-box;" onfocus="this.style.borderColor='#6c63ff'" onblur="this.style.borderColor='#2a2a45'">
        </div>
        <button type="submit" id="email-submit-btn" data-testid="button-submit-email" style="width:100%;padding:14px;background:linear-gradient(135deg,#6c63ff,#4f46e5);color:white;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:4px;box-shadow:0 4px 16px rgba(108,99,255,0.3);transition:opacity 0.15s;">
          Crear cuenta / Entrar
        </button>
      </form>
      <button onclick="renderLogin()" data-testid="button-back-to-login" style="background:transparent;border:none;color:#6c63ff;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;padding:8px;">
        ← Volver
      </button>
    </div>
  `);
  document.getElementById("reg-name").focus();
}
window.showEmailForm = showEmailForm;

async function submitEmailForm(e) {
  e.preventDefault();
  const name = document.getElementById("reg-name").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const phone = document.getElementById("reg-phone").value.trim();
  const errorDiv = document.getElementById("email-form-error");
  const submitBtn = document.getElementById("email-submit-btn");

  if (!name || !email) {
    errorDiv.textContent = "Nombre y correo son requeridos";
    errorDiv.style.display = "block";
    return;
  }

  errorDiv.style.display = "none";
  submitBtn.disabled = true;
  submitBtn.style.opacity = "0.6";
  submitBtn.textContent = "Registrando...";

  try {
    const data = await apiPost("/auth/email", { name, email, phone: phone || undefined });
    state.token = data.token;
    state.customer = data.customer;
    saveSession();
    await loadHomeData();
    renderHome();
  } catch (err) {
    let msg = "Error al registrar";
    try { msg = JSON.parse(err.message).message; } catch (_) { msg = err.message; }
    errorDiv.textContent = msg;
    errorDiv.style.display = "block";
    submitBtn.disabled = false;
    submitBtn.style.opacity = "1";
    submitBtn.textContent = "Crear cuenta / Entrar";
  }
}
window.submitEmailForm = submitEmailForm;

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

  // Read tenant from URL param and persist it (QR scan sets ?tenant=X)
  const params = new URLSearchParams(window.location.search);
  const tenantParam = params.get("tenant");
  if (tenantParam) {
    state.tenantId = parseInt(tenantParam);
    localStorage.setItem("loyalty_tenant_id", tenantParam);
  } else {
    const stored = localStorage.getItem("loyalty_tenant_id");
    if (stored) state.tenantId = parseInt(stored);
  }

  // Handle redirect back from Google OAuth (implicit flow: id_token in URL hash)
  const hash = window.location.hash;
  if (hash && hash.includes("id_token=")) {
    const hashParams = new URLSearchParams(hash.substring(1));
    const idToken = hashParams.get("id_token");
    if (idToken) {
      window.history.replaceState({}, document.title, "/");
      showLoading();
      try {
        const data = await apiPost("/auth/google", { idToken, tenantId: state.tenantId || undefined });
        state.token = data.token;
        state.customer = data.customer;
        saveSession();
        await loadHomeData();
        renderHome();
        return;
      } catch (e) {
        showError("Error al iniciar sesión: " + (e.message || "intenta de nuevo"));
        setTimeout(renderLogin, 2500);
        return;
      }
    }
  }

  // Handle redirect back from GIS redirect mode (POST callback → query params)
  const loginSuccess = params.get("login_success");
  const tokenParam = params.get("token");
  const errorParam = params.get("error");

  if (errorParam) {
    window.history.replaceState({}, document.title, "/");
    showError("Error al iniciar sesión: " + decodeURIComponent(errorParam));
    setTimeout(renderLogin, 2000);
    return;
  }

  if (loginSuccess && tokenParam) {
    try {
      const payload = JSON.parse(atob(tokenParam));
      state.token = tokenParam;
      state.customer = {
        id: payload.customerId,
        email: payload.email,
        name: payload.name || payload.email,
        photoUrl: payload.photoUrl || null,
      };
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

  renderLogin();
}

window.init = init;
window.renderHome = renderHome;
window.goHome = goHome;
window.loadRestaurantDetail = loadRestaurantDetail;
window.logout = logout;

init();
