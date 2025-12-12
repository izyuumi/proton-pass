import { List, ActionPanel, Action, Icon, showToast, Toast, Clipboard, getPreferenceValues, Detail } from "@raycast/api";
import { useState, useEffect } from "react";
import { listItems, getItem, getItemRaw, getTotp, checkAuth } from "./lib/pass-cli";
import { Item, ItemDetail as ItemDetailType, Preferences, PassCliError } from "./lib/types";
import { getItemIcon, formatItemSubtitle, maskPassword, formatTotpCode } from "./lib/utils";

const PROTON_PASS_CLI_DOCS = "https://protonpass.github.io/pass-cli/";

function ItemDetail({ item }: { item: Item }) {
  const [detail, setDetail] = useState<ItemDetailType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const preferences = getPreferenceValues<Preferences>();

  useEffect(() => {
    loadDetail();
  }, []);

  async function loadDetail() {
    try {
      const itemDetail = await getItem(item.shareId, item.itemId);
      setDetail(itemDetail);
    } catch (error: any) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to load item details",
        message: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return <Detail isLoading={true} />;
  }

  if (!detail) {
    return <Detail markdown="Failed to load item details" />;
  }

  const markdownParts: string[] = [];

  markdownParts.push(`# ${detail.title}\n`);
  markdownParts.push(`**Type:** ${detail.type}`);
  markdownParts.push(`**Vault:** ${detail.vaultName}\n`);

  if (detail.username) {
    markdownParts.push(`**Username:** ${detail.username}`);
  }

  if (detail.email) {
    markdownParts.push(`**Email:** ${detail.email}`);
  }

  if (detail.password) {
    markdownParts.push(`**Password:** ${maskPassword(detail.password)}`);
  }

  if (detail.urls && detail.urls.length > 0) {
    markdownParts.push(`\n**URLs:**`);
    detail.urls.forEach((url) => {
      markdownParts.push(`- ${url}`);
    });
  }

  if (detail.note) {
    markdownParts.push(`\n**Note:**\n${detail.note}`);
  }

  if (detail.customFields && detail.customFields.length > 0) {
    markdownParts.push(`\n**Custom Fields:**`);
    detail.customFields.forEach((field) => {
      const value = field.type === "hidden" ? maskPassword(field.value) : field.value;
      markdownParts.push(`- **${field.name}:** ${value}`);
    });
  }

  if (detail.hasTotp) {
    markdownParts.push(`\n**2FA:** Enabled`);
  }

  const markdown = markdownParts.join("\n");

  return (
    <Detail
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Type" text={detail.type} icon={getItemIcon(detail.type)} />
          <Detail.Metadata.Label title="Vault" text={detail.vaultName} />
          {detail.username && <Detail.Metadata.Label title="Username" text={detail.username} />}
          {detail.email && <Detail.Metadata.Label title="Email" text={detail.email} />}
          {detail.hasTotp && <Detail.Metadata.Label title="2FA" icon={Icon.Clock} />}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <ActionPanel.Section title="Copy">
            {detail.password && (
              <Action
                title="Copy Password"
                icon={Icon.Key}
                shortcut={{ modifiers: ["cmd"], key: "c" }}
                onAction={async () => {
                  await Clipboard.copy(detail.password!, { transient: preferences.copyPasswordTransient ?? true });
                  showToast({ style: Toast.Style.Success, title: "Password Copied" });
                }}
              />
            )}
            {detail.username && (
              <Action.CopyToClipboard
                title="Copy Username"
                content={detail.username}
                shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
              />
            )}
            {detail.email && (
              <Action.CopyToClipboard
                title="Copy Email"
                content={detail.email}
                shortcut={{ modifiers: ["cmd", "opt"], key: "c" }}
              />
            )}
            {detail.urls && detail.urls.length > 0 && (
              <Action.CopyToClipboard
                title="Copy First URL"
                content={detail.urls[0]}
                shortcut={{ modifiers: ["cmd"], key: "u" }}
              />
            )}
            {detail.hasTotp && (
              <Action
                title="Copy TOTP Code"
                icon={Icon.Clock}
                shortcut={{ modifiers: ["cmd"], key: "t" }}
                onAction={async () => {
                  try {
                    const totp = await getTotp(detail.shareId, detail.itemId);
                    await Clipboard.copy(totp);
                    showToast({ style: Toast.Style.Success, title: "TOTP Copied", message: formatTotpCode(totp) });
                  } catch (error: any) {
                    showToast({ style: Toast.Style.Failure, title: "Failed to get TOTP", message: error.message });
                  }
                }}
              />
            )}
            {detail.note && (
              <Action.CopyToClipboard
                title="Copy Note"
                content={detail.note}
                shortcut={{ modifiers: ["cmd"], key: "n" }}
              />
            )}
          </ActionPanel.Section>
          {detail.customFields && detail.customFields.length > 0 && (
            <ActionPanel.Section title="Custom Fields">
              {detail.customFields.map((field, index) => (
                <Action.CopyToClipboard
                  key={index}
                  title={`Copy ${field.name}`}
                  content={field.value}
                  shortcut={index < 9 ? { modifiers: ["cmd", "shift"], key: (index + 1).toString() as any } : undefined}
                />
              ))}
            </ActionPanel.Section>
          )}
          {detail.urls && detail.urls.length > 1 && (
            <ActionPanel.Section title="URLs">
              {detail.urls.map((url, index) => (
                <Action.OpenInBrowser key={index} title={`Open ${url}`} url={url} />
              ))}
            </ActionPanel.Section>
          )}
          <ActionPanel.Section title="Debug">
            <Action.CopyToClipboard
              title="Copy Item Debug Info"
              content={JSON.stringify(
                {
                  type: detail.type,
                  hasPassword: !!detail.password,
                  hasUsername: !!detail.username,
                  hasEmail: !!detail.email,
                  hasUrls: !!detail.urls?.length,
                  hasNote: !!detail.note,
                  hasTotp: detail.hasTotp,
                  customFieldsCount: detail.customFields?.length ?? 0,
                },
                null,
                2
              )}
              shortcut={{ modifiers: ["cmd", "shift"], key: "d" }}
            />
            <Action
              title="Copy Raw CLI Output"
              icon={Icon.Terminal}
              shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
              onAction={async () => {
                try {
                  const raw = await getItemRaw(detail.shareId, detail.itemId);
                  await Clipboard.copy(raw);
                  showToast({ style: Toast.Style.Success, title: "Raw JSON Copied", message: "Paste to see actual CLI output" });
                } catch (error: any) {
                  showToast({ style: Toast.Style.Failure, title: "Failed", message: error.message });
                }
              }}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

export default function Command() {
  const [items, setItems] = useState<Item[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<{ type: string; message?: string } | null>(null);
  const preferences = getPreferenceValues<Preferences>();

  useEffect(() => {
    loadItems();
  }, []);

  async function loadItems() {
    setError(null);
    setIsLoading(true);
    try {
      const isAuth = await checkAuth();
      if (!isAuth) {
        setError({ type: "not_authenticated" });
        setIsLoading(false);
        return;
      }

      const allItems = await listItems();
      setItems(allItems);
    } catch (error: any) {
      if (error instanceof PassCliError) {
        if (error.type === "not_installed") {
          setError({ type: "not_installed" });
        } else if (error.type === "not_authenticated") {
          setError({ type: "not_authenticated" });
        } else {
          setError({ type: "generic", message: error.message });
        }
      } else {
        setError({ type: "generic", message: error.message || "An unknown error occurred" });
      }
    } finally {
      setIsLoading(false);
    }
  }

  if (error?.type === "not_installed") {
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Proton Pass CLI Not Installed"
          description="Install pass-cli to use this extension"
          actions={
            <ActionPanel>
              <Action.OpenInBrowser title="Installation Guide" url={PROTON_PASS_CLI_DOCS} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  if (error?.type === "not_authenticated") {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Lock}
          title="Not Logged In"
          description="Run 'pass-cli login' in terminal to authenticate"
          actions={
            <ActionPanel>
              <Action.OpenInBrowser title="View Login Instructions" url={PROTON_PASS_CLI_DOCS} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  if (error?.type === "generic") {
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Failed to Load Items"
          description={error.message || "An unknown error occurred"}
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={loadItems} />
              <Action.OpenInBrowser title="View Documentation" url={PROTON_PASS_CLI_DOCS} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search items..." filtering={true}>
      {items.length === 0 && !isLoading ? (
        <List.EmptyView icon={Icon.MagnifyingGlass} title="No Items Found" description="Your vaults are empty" />
      ) : (
        items.map((item) => (
          <List.Item
            key={`${item.shareId}-${item.itemId}`}
            icon={getItemIcon(item.type)}
            title={item.title}
            subtitle={formatItemSubtitle(item)}
            accessories={[
              item.hasTotp ? { icon: Icon.Clock, tooltip: "Has TOTP" } : null,
              { text: item.vaultName },
            ].filter((a): a is NonNullable<typeof a> => a !== null)}
            actions={
              <ActionPanel>
                <ActionPanel.Section title="Copy">
                  {item.type === "login" && (
                    <Action
                      title="Copy Password"
                      icon={Icon.Key}
                      shortcut={{ modifiers: ["cmd"], key: "c" }}
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
                        } catch (error: any) {
                          showToast({ style: Toast.Style.Failure, title: "Failed to copy password", message: error.message });
                        }
                      }}
                    />
                  )}
                  {item.username && (
                    <Action.CopyToClipboard
                      title="Copy Username"
                      content={item.username}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                    />
                  )}
                  {item.email && (
                    <Action.CopyToClipboard
                      title="Copy Email"
                      content={item.email}
                      shortcut={{ modifiers: ["cmd", "opt"], key: "c" }}
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
                          await Clipboard.copy(totp);
                          showToast({ style: Toast.Style.Success, title: "TOTP Copied", message: formatTotpCode(totp) });
                        } catch (error: any) {
                          showToast({ style: Toast.Style.Failure, title: "Failed to get TOTP", message: error.message });
                        }
                      }}
                    />
                  )}
                </ActionPanel.Section>
                <ActionPanel.Section>
                  <Action.Push
                    title="View Details"
                    icon={Icon.Eye}
                    target={<ItemDetail item={item} />}
                    shortcut={{ modifiers: ["cmd"], key: "d" }}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
