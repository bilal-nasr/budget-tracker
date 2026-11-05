import { expect, it } from "vitest";
import { convertTransferAtRate } from "./transfer-amounts";
const usd={code:"USD",symbol:"$",decimalPlaces:3,disabled:false,firstUsed:false};
const lbp={code:"LBP",symbol:"L",decimalPlaces:2,disabled:false,firstUsed:false};
it("scales saved USD/LBP rates through runtime precisions in both directions",()=>{
 expect(convertTransferAtRate(1234,usd,lbp,89500)).toBe(11044300);
 expect(convertTransferAtRate(11044300,lbp,usd,89500)).toBe(1234);
 expect(convertTransferAtRate(100,usd,{...lbp,code:"TOK"},89500)).toBeNull();
});
