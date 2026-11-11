# Demo recording script

Aim for a 45–60 second edited walkthrough, not a claim that first-time setup takes under a minute. Use a new disposable directory, the published CLI, Node 26+, and JDK 21. Preflight network access, Maven cache, and the application port. If downloads are cut or sped up, label that edit.

| Segment | Action | Explanation |
| --- | --- | --- |
| 0–8 s | Show `jpm --version`, then `jpm create demo --java 21 -y` | A Spring MVC starting point from Initializr |
| 8–18 s | `cd demo`; show `package.json` and `.jpmrc` | Java dependencies in JSON; project JDK choice |
| 18–28 s | `jpm install`, then `jpm doctor` | Maven resolves dependencies; doctor checks the environment |
| 28–45 s | `jpm dev`; open localhost:8080; edit the controller's response | Compilation and a DevTools restart update the response |
| 45–60 s | Stop dev with Ctrl-C; `jpm build`; show the JAR | The result is a standard Java application |

Use a second terminal or browser for the HTTP response. Find the generated controller under `src/main/java`; change only the response string and wait for a successful restart. Do not show a successful response over a failed compile. If port 8080 is occupied, pass `-- -Dspring-boot.run.arguments=--server.port=8081` to `dev` and use that port consistently.

End with the repository URL and `npm install --global java-npm@alpha` only after publication. Keep the alpha label and Node/platform requirements visible in the caption. Avoid personal directory names, credentials, private registry URLs, or unrelated terminal history.
