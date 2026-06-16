import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from "axios";

import { useAuthStore } from "./auth";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";

export const api = axios.create({ baseURL: BASE_URL });

/** Attach the access token and active-shop header to every request. */
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { access, activeShopId } = useAuthStore.getState();
  if (access) config.headers.set("Authorization", `Bearer ${access}`);
  if (activeShopId) config.headers.set("X-Shop-Id", activeShopId);
  return config;
});

// Dedupe concurrent refreshes so a burst of 401s triggers one refresh call.
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refresh = useAuthStore.getState().refresh;
  if (!refresh) throw new Error("No refresh token");
  // Bare axios (not `api`) so this request skips the interceptors.
  const { data } = await axios.post<{ access: string }>(`${BASE_URL}/auth/refresh`, { refresh });
  useAuthStore.getState().setTokens({ access: data.access });
  return data.access;
}

function redirectToLogin() {
  useAuthStore.getState().clear();
  if (window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status = error.response?.status;
    const isAuthEndpoint = original?.url?.includes("/auth/");

    if (status === 401 && original && !original._retried && !isAuthEndpoint) {
      original._retried = true;
      try {
        refreshPromise = refreshPromise ?? refreshAccessToken();
        const access = await refreshPromise;
        refreshPromise = null;
        original.headers = { ...original.headers, Authorization: `Bearer ${access}` };
        return api(original);
      } catch (refreshError) {
        refreshPromise = null;
        redirectToLogin();
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  },
);
