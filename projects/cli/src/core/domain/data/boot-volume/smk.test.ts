import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { BootVolumeAdapter } from "./mod.ts";

const adapter = new BootVolumeAdapter();

Deno.test("BootVolumeAdapter exposes detectBootVolume", () => { assertEquals(typeof adapter.detectBootVolume, "function"); });
Deno.test("BootVolumeAdapter exposes patchDietpiTxt", () => { assertEquals(typeof adapter.patchDietpiTxt, "function"); });
Deno.test("BootVolumeAdapter exposes ensureConfigLine", () => { assertEquals(typeof adapter.ensureConfigLine, "function"); });
Deno.test("BootVolumeAdapter exposes ensureCmdlineParam", () => { assertEquals(typeof adapter.ensureCmdlineParam, "function"); });
