import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
type FixtureBalance = { id?: string; name: string; currency?: string; archived?: boolean; balanceMinor?: number };
/** Adapter for older interaction fixtures. New runtime tests use the real canonical provider. */
export function runtimeAppFixture<T extends { fixtureBalances?: FixtureBalance[]; fixtureBalanceById?: (id: string) => FixtureBalance | undefined; salary?: {balanceId: string; amountMinor: number} | null }>(input: T) {
 const rows = input.fixtureBalances ?? (input.salary && input.fixtureBalanceById?.(input.salary.balanceId) ? [input.fixtureBalanceById(input.salary.balanceId)!] : []);
 const get = (id: string) => rows.find((row) => row.id === id) ?? input.fixtureBalanceById?.(id);
 const wallet = (row: FixtureBalance, id: string) => ({id,name:row.name,kind:"cash" as const,position:0,deleted:row.archived ?? false,needsAttention:false,defaultBalanceId:id,balances:[{id,walletId:id,currency:row.currency ?? "USD",openingBalanceMinor:0,balanceMinor:row.balanceMinor ?? 0,position:0,detached:false}]});
 return {...input,currencies:SEED_CURRENCY_DEFINITIONS,enabledCurrencies:SEED_CURRENCY_DEFINITIONS,walletContainers:rows.filter((row)=>!row.archived).map((row)=>wallet(row,row.id!)),
 currencyByCode:(code:string)=>SEED_CURRENCY_DEFINITIONS.find((currency)=>currency.code===code),walletById:(id:string)=>{const row=get(id);return row?wallet(row,id):undefined;},balanceById:(id:string)=>{const row=get(id);return row?wallet(row,id).balances[0]:undefined;}};
}
