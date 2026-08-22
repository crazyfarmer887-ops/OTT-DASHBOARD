type RecruitingProduct = { productUsid: string; [key: string]: unknown };

type ManageDataWithRecruiting<TProduct extends RecruitingProduct = RecruitingProduct> = {
  onSaleByKeepAcct: Record<string, TProduct[]>;
  [key: string]: unknown;
};

export function removeRecruitingProductFromManageData<TData extends ManageDataWithRecruiting>(
  data: TData,
  keepAcct: string,
  productUsid: string,
): TData {
  const current = data.onSaleByKeepAcct?.[keepAcct] || [];
  const nextForAccount = current.filter(product => String(product.productUsid) !== String(productUsid));

  return {
    ...data,
    onSaleByKeepAcct: {
      ...data.onSaleByKeepAcct,
      [keepAcct]: nextForAccount,
    },
  };
}

export function applyCreatedProductsToManageData<TData extends ManageDataWithRecruiting>(
  data: TData,
  keepAcct: string,
  products: RecruitingProduct[],
): TData {
  if (products.length === 0) return data;
  return {
    ...data,
    onSaleByKeepAcct: {
      ...data.onSaleByKeepAcct,
      [keepAcct]: mergeRecruitingProductsLocal(data.onSaleByKeepAcct?.[keepAcct] || [], products),
    },
  };
}

export function rollbackCreatedProductsFromManageData<TData extends ManageDataWithRecruiting>(
  data: TData,
  keepAcct: string,
  products: RecruitingProduct[],
): TData {
  if (products.length === 0) return data;
  const usids = new Set(products.map(product => String(product.productUsid)));
  const current = data.onSaleByKeepAcct?.[keepAcct] || [];
  return {
    ...data,
    onSaleByKeepAcct: {
      ...data.onSaleByKeepAcct,
      [keepAcct]: current.filter(product => !usids.has(String(product.productUsid))),
    },
  };
}

function mergeRecruitingProductsLocal<T extends RecruitingProduct>(current: T[], incoming: T[]): T[] {
  const existing = new Set(current.map(product => String(product.productUsid)));
  const merged = [...current];
  for (const product of incoming) {
    if (!existing.has(String(product.productUsid))) merged.push(product);
  }
  return merged;
}
