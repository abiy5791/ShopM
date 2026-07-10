import { Route, Routes } from "react-router-dom";

import ActivityPage from "@/features/activity/ActivityPage";
import LoginPage from "@/features/auth/LoginPage";
import CustomersPage from "@/features/customers/CustomersPage";
import DashboardPage from "@/features/dashboard/DashboardPage";
import ExpensesPage from "@/features/expenses/ExpensesPage";
import OwnerConsolePage from "@/features/owner/OwnerConsolePage";
import POSPage from "@/features/pos/POSPage";
import ProductsPage from "@/features/products/ProductsPage";
import PurchasesPage from "@/features/purchases/PurchasesPage";
import ReportsPage from "@/features/reports/ReportsPage";
import SalesPage from "@/features/sales/SalesPage";
import SettingsPage from "@/features/settings/SettingsPage";

import { RequireAuth, RoleGate } from "./guards";
import { AppShell } from "./layout/AppShell";

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route
          path="pos"
          element={
            <RoleGate allow={["owner", "cashier"]}>
              <POSPage />
            </RoleGate>
          }
        />
        <Route
          path="sales"
          element={
            <RoleGate allow={["owner", "cashier"]}>
              <SalesPage />
            </RoleGate>
          }
        />
        <Route path="products" element={<ProductsPage />} />
        <Route
          path="customers"
          element={
            <RoleGate allow={["owner", "cashier"]}>
              <CustomersPage />
            </RoleGate>
          }
        />
        <Route
          path="purchases"
          element={
            <RoleGate allow={["owner"]}>
              <PurchasesPage />
            </RoleGate>
          }
        />
        <Route
          path="expenses"
          element={
            <RoleGate allow={["owner"]}>
              <ExpensesPage />
            </RoleGate>
          }
        />
        <Route
          path="reports"
          element={
            <RoleGate allow={["owner"]}>
              <ReportsPage />
            </RoleGate>
          }
        />
        <Route
          path="console"
          element={
            <RoleGate allow={["owner"]}>
              <OwnerConsolePage />
            </RoleGate>
          }
        />
        <Route path="activity" element={<ActivityPage />} />
        <Route
          path="settings"
          element={
            <RoleGate allow={["owner"]}>
              <SettingsPage />
            </RoleGate>
          }
        />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-full items-center justify-center p-8 text-center">
      <div>
        <h1 className="text-2xl font-semibold">404</h1>
        <p className="mt-1 text-sm text-muted-foreground">This page doesn&apos;t exist.</p>
      </div>
    </div>
  );
}
