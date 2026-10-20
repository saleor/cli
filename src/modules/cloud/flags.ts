import { catalogInfo } from "../../core/input-info.ts";

catalogInfo.flag("region", { default: "us-east-1" });

catalogInfo.flag("plan", { default: "dev" });

export const domainLabelDescription =
  "Subdomain for the environment (<label>.saleor.cloud). Without it, Saleor Cloud picks one and can hand out an already-running environment, which is much faster.";

export const regionDescription =
  'Region for a new project. Defaults to "us-east-1".';
