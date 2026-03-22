import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { OverclockHelpers } from "./mod.ts";

const h = new OverclockHelpers();

Deno.test("levelDesc formats level with over_voltage", () => {
  assertEquals(h.levelDesc({ arm_freq: 1800, over_voltage: 4, temp_limit: 82 }), "arm_freq=1800, over_voltage=4");
});

Deno.test("levelDesc prefers over_voltage_delta when present", () => {
  assertEquals(h.levelDesc({ arm_freq: 2600, over_voltage_delta: 10000, temp_limit: 82 }), "arm_freq=2600, over_voltage_delta=10000");
});

Deno.test("overclockLines generates config lines with over_voltage", () => {
  assertEquals(h.overclockLines({ arm_freq: 1800, over_voltage: 4, temp_limit: 82 }), "arm_freq=1800\ntemp_limit=82\nover_voltage=4");
});

Deno.test("overclockLines generates config lines with over_voltage_delta", () => {
  assertEquals(h.overclockLines({ arm_freq: 2600, over_voltage_delta: 10000, temp_limit: 82 }), "arm_freq=2600\ntemp_limit=82\nover_voltage_delta=10000");
});

Deno.test("overclockLines omits voltage when neither is set", () => {
  assertEquals(h.overclockLines({ arm_freq: 1500, temp_limit: 80 }), "arm_freq=1500\ntemp_limit=80");
});

Deno.test("patchConfigTxtScript generates sed + append command", () => {
  const script = h.patchConfigTxtScript({ arm_freq: 1800, over_voltage: 4, temp_limit: 82 });
  assertEquals(script.includes("sed -i"), true);
  assertEquals(script.includes("/^arm_freq=/d"), true);
  assertEquals(script.includes("arm_freq=1800"), true);
});

Deno.test("patchConfigTxtScript strips all overclock keys", () => {
  const script = h.patchConfigTxtScript({ arm_freq: 2600, over_voltage_delta: 10000, temp_limit: 82 });
  assertEquals(script.includes("/^over_voltage_delta=/d"), true);
});
