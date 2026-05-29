import {
  List,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  Clipboard,
  getPreferenceValues,
  BrowserExtension,
  environment,
  Color,
} from "@raycast/api";
import { useState, useEffect, useMemo, useRef } from "react";
import { usePromise } from "@raycast/utils";
import { listItemsStreaming, getItem, getTotp } from "./lib/pass-cli";
import { Item, PassCliError, PassCliErrorType, Vault } from "./lib/types";
import { getItemIcon, formatItemSubtitle, getTotpRemainingSeconds, formatTotpCode } from "./lib/utils";
import { getCachedItems, setCachedItems, getCachedVaults, setCachedVaults } from "./lib/cache";
import { renderErrorView } from "./lib/error-views";

function originOf(raw?: string): string | undefined {
  if (!raw) return undefined;

  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}

function matchesActiveOrigin(item: Item, activeOrigin?: string): boolean {
  if (!activeOrigin || !item.urls || item.urls.length === 0) return false;
  return item.urls.some((url) => originOf(url) === activeOrigin);
}

const ALL_VAULTS_VALUE = "all";

function VaultDropdown({ vaults, onVaultChange }: { vaults: Vault[]; onVaultChange: (vaultId: string) => void }) {
  return (
    <List.Dropdown tooltip="Select Vault" storeValue={true} onChange={onVaultChange} defaultValue={ALL_VAULTS_VALUE}>
      <List.Dropdown.Item title="All Vaults" value={ALL_VAULTS_VALUE} icon={Icon.Globe} />
      <List.Dropdown.Section title="Vaults">
        {vaults.map((vault) => (
          <List.Dropdown.Item key={vault.shareId} title={vault.name} value={vault.shareId} icon={Icon.Folder} />
        ))}
      </List.Dropdown.Section>
    </List.Dropdown>
  );
}

export default function Command() {
  const [items, setItems] = useState<Item[]>([]);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [selectedVaultId, setSelectedVaultId] = useState<string>(ALL_VAULTS_VALUE);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<{ type: PassCliErrorType; message?: string } | null>(null);
  const [totpCodes, setTotpCodes] = useState<Record<string, string>>({});
  const [remainingSeconds, setRemainingSeconds] = useState(getTotpRemainingSeconds());
  const preferences = getPreferenceValues<Preferences>();
  const backgroundRefreshEnabled = preferences.enableBackgroundRefresh ?? true;
  const webIntegrationEnabled = preferences.enableWebIntegration ?? true;
  const hasLoadedFromCache = useRef(false);
  const allItemsRef = useRef<Item[]>([]);
  const fetchedTotpIdsRef = useRef<Set<string>>(new Set());
  const isFetchingTotpRef = useRef(false);
  const totpTimeStepRef = useRef(Math.floor(Date.now() / 30_000));
  const { data: activeOrigin } = usePromise(
    async (isWebIntegrationEnabled: boolean) => {
      if (!isWebIntegrationEnabled) return undefined;
      if (!environment.canAccess(BrowserExtension)) return undefined;

      try {
        const tabs = await BrowserExtension.getTabs();
        return originOf(tabs.find((tab) => tab.active)?.url);
      } catch {
        return undefined;
      }
    },
    [webIntegrationEnabled],
  );

  useEffect(() => {
    loadItems();
  }, []);

  useEffect(() => {
    allItemsRef.current = items;
    const unfetched = items.filter((i) => i.hasTotp && !fetchedTotpIdsRef.current.has(i.itemId));
    if (unfetched.length === 0) return;
    unfetched.forEach((i) => fetchedTotpIdsRef.current.add(i.itemId));
    unfetched.forEach(async (item) => {
      try {
        const code = await getTotp(item.shareId, item.itemId);
        setTotpCodes((prev) => ({ ...prev, [item.itemId]: code }));
      } catch {
        // ignore
      }
    });
  }, [items]);

  useEffect(() => {
    const interval = setInterval(() => {
      setRemainingSeconds(getTotpRemainingSeconds());
      const nextStep = Math.floor(Date.now() / 30_000);
      if (nextStep !== totpTimeStepRef.current) {
        totpTimeStepRef.current = nextStep;
        refreshTotpCodes();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  async function refreshTotpCodes() {
    if (isFetchingTotpRef.current) return;
    isFetchingTotpRef.current = true;
    const totpItems = allItemsRef.current.filter((i) => i.hasTotp);
    const updated: Record<string, string> = {};
    await Promise.all(
      totpItems.map(async (item) => {
        try {
          updated[item.itemId] = await getTotp(item.shareId, item.itemId);
        } catch {
          // ignore
        }
      }),
    );
    setTotpCodes((prev) => ({ ...prev, ...updated }));
    isFetchingTotpRef.current = false;
  }

  async function loadItems() {
    setError(null);

    const [cachedItems, cachedVaults] = await Promise.all([getCachedItems(), getCachedVaults()]);
    if (cachedItems && cachedVaults && !hasLoadedFromCache.current) {
      setItems(cachedItems);
      setVaults(cachedVaults);
      setIsLoading(false);
      hasLoadedFromCache.current = true;

      if (!backgroundRefreshEnabled) {
        return;
      }
    }

    try {
      let isFirstBatch = true;
      const { vaults: freshVaults, allItems: freshItems } = await listItemsStreaming((batch) => {
        if (isFirstBatch) {
          setItems(batch);
          isFirstBatch = false;
        } else {
          setItems((prev) => [...prev, ...batch]);
        }
      });
      setVaults(freshVaults);

      await Promise.all([setCachedItems(freshItems), setCachedVaults(freshVaults)]);
    } catch (err: unknown) {
      if (!hasLoadedFromCache.current) {
        if (err instanceof PassCliError) {
          setError({ type: err.type, message: err.message });
        } else {
          const message = err instanceof Error ? err.message : "An unknown error occurred";
          setError({ type: "unknown", message });
        }
      }
    } finally {
      setIsLoading(false);
    }
  }

  const filteredItems =
    selectedVaultId === ALL_VAULTS_VALUE ? items : items.filter((item) => item.shareId === selectedVaultId);
  const sortedFilteredItems = useMemo(() => {
    if (!webIntegrationEnabled || !activeOrigin) return filteredItems;

    return [...filteredItems].sort((a, b) => {
      const aMatch = matchesActiveOrigin(a, activeOrigin);
      const bMatch = matchesActiveOrigin(b, activeOrigin);
      if (aMatch === bMatch) return 0;
      return aMatch ? -1 : 1;
    });
  }, [activeOrigin, filteredItems, webIntegrationEnabled]);

  const selectedItemId = useMemo(() => {
    if (!webIntegrationEnabled || !activeOrigin) return undefined;
    const match = sortedFilteredItems.find((item) => matchesActiveOrigin(item, activeOrigin));
    return match ? `${match.shareId}-${match.itemId}` : undefined;
  }, [activeOrigin, sortedFilteredItems, webIntegrationEnabled]);

  const totpTimerColor = remainingSeconds > 10 ? Color.Green : remainingSeconds > 5 ? Color.Yellow : Color.Red;

  const errorView = renderErrorView(error?.type ?? null, loadItems, "Load Items");
  if (errorView) return errorView;

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search items..."
      filtering={true}
      selectedItemId={selectedItemId}
      searchBarAccessory={<VaultDropdown vaults={vaults} onVaultChange={setSelectedVaultId} />}
    >
      {filteredItems.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title="No Items Found"
          description={selectedVaultId === ALL_VAULTS_VALUE ? "Your vaults are empty" : "No items in this vault"}
        />
      ) : (
        sortedFilteredItems.map((item) => (
          <List.Item
            key={`${item.shareId}-${item.itemId}`}
            icon={getItemIcon(item.type)}
            title={item.title}
            subtitle={formatItemSubtitle(item)}
            accessories={[
              item.hasTotp
                ? {
                    tag: {
                      value: totpCodes[item.itemId] ? formatTotpCode(totpCodes[item.itemId]) : "···",
                      color: totpTimerColor,
                    },
                    tooltip: `${remainingSeconds}s remaining`,
                  }
                : null,
              { text: item.vaultName },
            ].filter((a): a is NonNullable<typeof a> => a !== null)}
            actions={
              <ActionPanel>
                {item.type === "login" && (
                  <Action
                    title="Copy Password"
                    icon={Icon.Key}
                    onAction={async () => {
                      try {
                        const detail = await getItem(item.shareId, item.itemId);
                        if (detail.password) {
                          await Clipboard.copy(detail.password, {
                            transient: preferences.copyPasswordTransient ?? true,
                          });
                          showToast({ style: Toast.Style.Success, title: "Password Copied" });
                        } else {
                          showToast({
                            style: Toast.Style.Failure,
                            title: "No Password Found",
                            message: `Item type: ${detail.type}. Check if pass-cli item view returns password field.`,
                          });
                        }
                      } catch (error: unknown) {
                        const message = error instanceof Error ? error.message : "An unknown error occurred";
                        showToast({ style: Toast.Style.Failure, title: "Failed to copy password", message });
                      }
                    }}
                  />
                )}
                {item.email && (
                  <Action
                    title="Copy Email"
                    icon={Icon.Envelope}
                    shortcut={{ modifiers: ["cmd"], key: "e" }}
                    onAction={async () => {
                      await Clipboard.copy(item.email!);
                      showToast({ style: Toast.Style.Success, title: "Email Copied" });
                    }}
                  />
                )}
                {item.username && (
                  <Action
                    title="Copy Username"
                    icon={Icon.Person}
                    shortcut={{ modifiers: ["cmd"], key: "u" }}
                    onAction={async () => {
                      await Clipboard.copy(item.username!);
                      showToast({ style: Toast.Style.Success, title: "Username Copied" });
                    }}
                  />
                )}
                {item.hasTotp && (
                  <Action
                    title="Copy TOTP Code"
                    icon={Icon.Clock}
                    shortcut={{ modifiers: ["cmd"], key: "t" }}
                    onAction={async () => {
                      try {
                        const totp = await getTotp(item.shareId, item.itemId);
                        await Clipboard.copy(totp, { transient: preferences.copyPasswordTransient ?? true });
                        showToast({ style: Toast.Style.Success, title: "TOTP Copied", message: "Clipboard updated" });
                      } catch (error: unknown) {
                        const message = error instanceof Error ? error.message : "An unknown error occurred";
                        showToast({ style: Toast.Style.Failure, title: "Failed to get TOTP", message });
                      }
                    }}
                  />
                )}
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
