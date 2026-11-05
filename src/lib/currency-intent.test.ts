import { expect, it } from "vitest";
import { currencyIntent, expectedUnitsSchema, withoutCurrencyIntent } from "./currency-intent";
const usd={code:"USD",symbol:"$",decimalPlaces:2,disabled:false,firstUsed:false};
it("captures only supplied units and deduplicates identical definitions",()=>{expect(currencyIntent(usd,{...usd,symbol:"Dollar"},{...usd,code:"TOKEN",decimalPlaces:8})).toEqual({USD:2,TOKEN:8});});
it("rejects conflicting precisions of the same code instead of replacing parsed intent",()=>{expect(()=>currencyIntent(usd,{...usd,decimalPlaces:8})).toThrow("Conflicting draft units");});
it("does not fill missing parsed units",()=>{expect(currencyIntent(usd,undefined)).toBeUndefined();expect(currencyIntent()).toBeUndefined();});
it("validates bounded exact unit maps",()=>{for(const units of [{},{USD:9},{USD:2.5},{usd:2},Object.fromEntries(Array.from({length:65},(_,n)=>[`C${n}`,2]))])expect(expectedUnitsSchema.safeParse(units).success).toBe(false);});
it("keeps the legacy RPC body free from transport metadata",()=>{expect(withoutCurrencyIntent({amountMinor:100,expectedUnits:{USD:2}})).toEqual({amountMinor:100});});
