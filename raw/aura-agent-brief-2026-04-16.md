# Aura Agent -- Initial Brief

Source: User message
Ingested: 2026-04-16

---

I'd like to build a personal agent that's focused on running test, watching the output from test, notifying user if error occurs. One of the scenarios I want to do with this agent is something like this:

0. Build it in a TUI format
1. User talks to the agent with natural language, for example, user asks it to run a test X.
2. The agent should let user know if it needs information about test (where the test script is located, what system the user want to run the test, what kind of arguments required to run the test etc. but not limited to this)
3. Once the agent has all the necessary information about the test, it runs the test in the desired system.
4. Keep reporting (polling) status to user (Imagine, how Claude Code works when there is a user request. It keeps running in a loop until it meets the goal)
5. If there is any error happening, it should notify the user
   (User will specify what error the agent should stop the process or keep going but just notify the user)
6. Once the test is completed, summarize the test results and notify user (exactly like how Claude Code does)

So user will define the test information, instructions or how to summarize test if needed. I want the agent to ask user's permission before its actions, but like claude bypass permission, I'd like to have that option. So start with human-in-the-loop but we also covers agent-in-the-loop (human-out-of-the-loop).

The tool I'm thinking to use is Github Copilot SDK.

Let me know if there's any ambiguity.
