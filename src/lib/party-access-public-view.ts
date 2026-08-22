export interface PartyAccessPublicViewLoaderOptions<Store> {
  localStore: Store;
  isFillRecord: boolean;
  liveRefreshSetting: string | undefined;
  refresh: (store: Store) => Promise<Store>;
}

export function partyAccessLiveRefreshEnabled(setting: string | undefined): boolean {
  return setting !== 'false';
}

export async function loadPartyAccessStoreForPublicView<Store>(
  options: PartyAccessPublicViewLoaderOptions<Store>,
): Promise<Store> {
  if (options.isFillRecord || !partyAccessLiveRefreshEnabled(options.liveRefreshSetting)) {
    return options.localStore;
  }
  return options.refresh(options.localStore);
}
