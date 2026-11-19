# TODO

- Make models name dynamic
- Install css and markdown libs locally
- Allow client to chose the specific model from a list of options
- Add testing
- Port to React if needed
- Detect usage / max size per prompt per model
- Add pasted files and files from system in a new block like claude.ai does
- Allow multiple API keys per model/API (if one fails, it has backup). 
- Add option to smart select model by tast (for example if you select Code, uses the best model available for that task)
- Add support to multiple files
- Add support for local models
- Fix current model and API versions (seek for best available free models)
- Add SMART routing. Instead of routing for priority, uses a fast model to classify the task and select the best avaiilable models (returns models order by priority)
- Add agentic mode. (uses local system provideed tools by a new special API endpoint). 
- Add live logs off whats going on all the time
- Add Cloudflare as a provider
- Add voice / tss
- Add multimodal (can use free models with puppeter) (can use small local models too)
- Add (or test) 2 modes for Puppeteer (As service always running, or per demand) 
- Add real streaming (with pause, continue, stop etc)
- PRIORITY: Use secure folder for agent (probably a proot is needed or something similar)
- Add ability to install tools in the system (also install them if any of of the reqjired ones are missing, like git)
- Add a Free Agent mode. (no limits, just a sleep between calls to don't exhaust resources or providers)
- Update / make a good README with images
- Update bash client with new features (like agent)
- Terminal might be redundant with shell (shell runs only on sandbox do)
- Clean the udocker storage to free space (outside of the project, just a reminder for the dev)
- Update help with --track-agent
- Update README.md
- Add Warning/Danger red icon to shell
- Test clone in clean Debian live CD
- Translate to english postinstall script output
- Add options to delete chats
- Add Continue button under the chat when stopped (optional)
- Add option to delete the chats (this removes them from everywhere, including context of the conversation)
- Add thinking (shows it if the models has it, if not, forces the model to think by combining models resources)
- Add streaming to agents
- Add debug middleware with the --debug flag


### Optimizations
- Resume the context by keeping a resume of the project + small context + resume from start to end. Then redirect the last message to the model after the context (allow user in config to setup max context and calculate from it)
- Have just 1 copy of the each file but not in context. Context only has the referekce and the index of the file in context. The file is either saves in a DB in the browser o directly in localfilesystem.
- Mode auto to autoselect BASED on the query itself. 
-
