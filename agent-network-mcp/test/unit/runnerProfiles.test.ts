import { describe, it, expect } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNNER_PROFILES, validateRunnerProfile, profileInstructions, type RunnerProfileId } from "../../src/runnerProfiles.js";
import { loadRunnersConfig, RunnerPool, saveRunner } from "../../src/ui/runners.js";
import { runRunner } from "../../src/runner.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { TaskStore } from "../../src/stores/taskStore.js";
import { tmpDir } from "../helpers/tmp.js";

describe("runner role profiles", () => {
  it("inherits defaults/templates, persists updates and explicit clear without changing model or command", async () => {
    const dir = await tmpDir(); const file = join(dir,"runners.json"); const custom = join(dir,"custom.md");
    await writeFile(custom,"Custom verification rule");
    await writeFile(file,JSON.stringify({defaults:{command:["fake","{model}","{prompt}"],model:"chosen-model",profile:"analyst",instructionsFile:custom},agents:[{id:"worker",autostart:false}],runnerTemplates:{fake:{models:["chosen-model"]}}}));
    let loaded = await loadRunnersConfig(file); expect(loaded.agents[0]!.profile).toBe("analyst"); expect(loaded.runnerTemplates![0]!.config.profile).toBe("analyst");
    const pool = new RunnerPool(join(dir,".network"),loaded.agents,{configPath:file});
    await expect(pool.setProfile("worker","unknown")).rejects.toThrow(/Unknown runner profile/);
    const before=pool.list()[0]!; await pool.setProfile("worker","reviewer");
    loaded=await loadRunnersConfig(file); expect(loaded.agents[0]!.profile).toBe("reviewer");
    expect(pool.list()[0]).toMatchObject({running:false,model:before.model,command:before.command,instructionsFile:before.instructionsFile});
    expect((await readFile(custom,"utf8"))).toBe("Custom verification rule");
    await pool.setProfile("worker",null); loaded=await loadRunnersConfig(file); expect(loaded.agents[0]!.profile).toBeUndefined();
    expect(JSON.parse(await readFile(file,"utf8")).agents[0].profile).toBeNull();
    const added=await saveRunner(file,{id:"another",template:"fake",profile:"developer"}); expect(added.profile).toBe("developer"); expect(added.model).toBe("chosen-model"); expect(added.autostart).toBe(false);
    await writeFile(file,JSON.stringify({defaults:{command:["fake"],profile:"unknown"},agents:[{id:"worker"}]}));
    await expect(loadRunnersConfig(file)).rejects.toThrow(/Unknown runner profile/);
  });
  it("layers changing roles and custom instructions into the actual next CLI session", async () => {
    const dir=await tmpDir(); const networkDir=join(dir,".network"); const fs=await FileStore.open(networkDir); const tasks=new TaskStore(fs);
    const task=await tasks.create({title:"Role test",description:"d",agents:["backend","reviewer"],createdBy:"operator",git:null});
    const custom=join(dir,"custom.md"); await writeFile(custom,"Custom verification rule"); const log=join(dir,"launches.jsonl");
    const fake=join(dirname(fileURLToPath(import.meta.url)),"..","helpers","fakeAgent.mjs");
    let role:RunnerProfileId="analyst"; let sessions=0; const abort=new AbortController(); const timer=setTimeout(()=>abort.abort(),10000);
    try {
      await runRunner({agent:"backend",networkDir,cwd:dir,command:[process.execPath,fake,log,"2","{prompt}"],instructionsFile:custom,roleInstructions:()=>profileInstructions(role),signal:abort.signal,pollMs:10,restartDelayMs:5,stdio:"ignore",log:()=>{},onSessionEnd:async()=>{sessions++;role="reviewer";if(sessions>=2)abort.abort();}});
      const launches=(await readFile(log,"utf8")).trim().split("\n").map(l=>JSON.parse(l));
      expect(launches).toHaveLength(2);
      expect(launches[0].args[0]).toContain("Role: Analyst"); expect(launches[1].args[0]).toContain("Role: Reviewer"); expect(launches[1].args[0]).not.toContain("Role: Analyst");
      for(const launch of launches) expect(launch.args[0]).toContain("Custom verification rule");
      expect((await tasks.get(task.id)).status).toBe("COMPLETED");
    } finally {clearTimeout(timer);abort.abort();}
  });
  it("roles describe scope guidance rather than model or permission changes",()=>{
    expect(validateRunnerProfile(null)).toBeNull(); expect(RUNNER_PROFILES).toHaveLength(3);
    for(const profile of RUNNER_PROFILES) expect(profile.instructions).toContain("file ownership");
    expect(profileInstructions("reviewer")).toContain("does not enforce read-only");
  });
});
