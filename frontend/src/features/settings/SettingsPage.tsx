import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { BranchesTab } from "./BranchesTab";
import { BusinessTab } from "./BusinessTab";
import { PreferencesTab } from "./PreferencesTab";
import { StaffTab } from "./StaffTab";

/** Owner control centre (v2 plan §3): business identity, branches, staff, and
 *  preferences — everything an owner runs the business with. */
export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" description="Your business, branches, staff, and preferences." />

      <Tabs defaultValue="business">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="business">Business</TabsTrigger>
          <TabsTrigger value="branches">Branches</TabsTrigger>
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
        </TabsList>

        <TabsContent value="business">
          <BusinessTab />
        </TabsContent>
        <TabsContent value="branches">
          <BranchesTab />
        </TabsContent>
        <TabsContent value="staff">
          <StaffTab />
        </TabsContent>
        <TabsContent value="preferences">
          <PreferencesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
