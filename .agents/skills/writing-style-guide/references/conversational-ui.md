# Chatbots and conversational UI

Search the headings or contents below and read the relevant sections, including their exceptions and examples. All detailed article text is retained here.

## Contents
- [Care and feeding of the bot](#care-and-feeding-of-the-bot)
- [Chatbots and virtual agents](#chatbots-and-virtual-agents)
- [Structural and technical considerations](#structural-and-technical-considerations)
- [Writing for bots](#writing-for-bots)

<a id="care-and-feeding-of-the-bot"></a>

## Care and feeding of the bot

```text
Care and feeding of the bot


Maintain the bot and evaluate its effectiveness
over time

Have a plan for maintaining and evolving the bot. What's working and what isn't?
What's your plan for phasing in new and improved features? What can be done better?
How will you know when it's time to retire your bot?

Learn from customers

      Make it possible for people to give you feedback directly through the bot. Ask if
      they got what they were looking for. Give them a way to tell you what they wanted
      if the results weren't what they expected.

      Label your content blocks in the flow. That way, you can identify the content blocks
      that users leave from the most, figure out why, and improve them.

      Extend or improve the experience when appropriate. For example, if the customer
      gives positive feedback, suggest they rate the app. If the experience didn't meet
      their expectations, provide a link to support.
```

<a id="chatbots-and-virtual-agents"></a>

## Chatbots and virtual agents

```text
Chatbots and virtual agents


A virtual agent is a type of bot that can be used to:

      Provide information and answers.
      Complete tasks like booking meetings or buying tickets.

Before you create a virtual agent, make sure it will add value to the customer
experience.

This type of bot is good for tasks where it's easier to ask for what you want rather than
navigate through a menu or search for keywords. But a bot isn't a human, and there are
some things that it isn't suited for.

Technically speaking, there are two kinds:

      One kind is scripted. It can respond only to questions that it was programmed to
      understand.
      Another uses AI, so it can understand what the customer is telling it, and its
      knowledge grows the more it interacts with people.

This section includes guidelines and tips to help you create this type of bot:

      Structural and technical considerations
      Writing for bots
      Care and feeding of the bot

Learn more
Microsoft's AI vision, rooted in research, conversations
Bot Framework documentation
Responsible bots: 10 guidelines for developers of conversational AI
```

<a id="structural-and-technical-considerations"></a>

## Structural and technical considerations

```text
Structural and technical considerations


Clarify intent before acting

Until you're sure your bot can reliably interpret conversational cues, it should:

     Confirm the customer's intent: "You need to reset your password. Is that right?"

     Clarify and disambiguate the customer's input when necessary: "OK, we'll reset
     your password. But first, I'd like to know more. Did you forget your password, or
     are you concerned that someone else has your password? You can say, "I forgot,"
     or "My account is compromised."

Be careful not to overdo it, though. It's better not to annoy the customer with a needless
prompt unless misunderstanding the request could cause damage.

Use buttons and other UI structure to keep
users on track

     Prompt users with actionable statements and buttons to guide the conversation.

     Offer suggestions when the bot is "confused" about what the user's request is.

Pace the conversation carefully

     Break up messages into separate, readable blocks to make the pace of the
     conversation feel more natural.

     Make sure the bot doesn't respond so quickly that it rushes the customer. Add a
     minimum delay if necessary.

Accommodate alternative word order and
incomplete requests

The bot should be able to recognize the customer's request, regardless of how it's
phrased.

Conclude the conversation when the request is
resolved

Mimic the sense of closure typical in human-to-human interaction by wrapping up the
conversation. For example: "Is there anything else I can help you with? [No.] OK, then.
Have a great day!" Having a sense of completion helps the customer feel like there's a
shared goal, reinforces the positive experience, and builds confidence in using the bot.
```

<a id="writing-for-bots"></a>

## Writing for bots

```text
Writing for bots


Tailor the tone of the bot's responses to the context. If it's something serious—like
billing or cybersecurity—be empathetic but brief and straightforward. If it's a more
mundane situation (like creating a new account), the tone can be more relaxed. And a
bot for Xbox can be lighthearted and casual.

See the brand voice

Be honest and build trust

      Make sure users know that they're not chatting with a person. For example, have
      the bot introduce itself as a virtual support agent. The message can be brief—
      research shows that customers are usually aware that they're chatting with a bot.

      Explain what the bot's purpose is and what it can and can't do. Good ways of
      framing the functionality are suggesting a first task or place to begin, or providing
      buttons or shortcuts for the most frequent tasks.

      Admit when things get messed up. And have a plan for dealing with the situation.

      Plan for common misspellings and errors. These don't derail human-to-human
      conversations, and being able to accommodate them will build the user's
      confidence in the bot.

Accept—and plan for—the bot's limitations

There are some questions a bot just won’t have an answer for.

      Make it clear to the user that the bot has a very specific role. Don't imply an open-
      ended, "Ask me anything" role.

      Be prepared for when the bot doesn't know the answer, and have it point the
      customer in the right direction.

      Decide what conversational cues will prompt the bot to escalate to a human. At
      key points in the conversation, let the customer know how they can get help from
      a human, if they want to.

Keep it simple, and keep it short

Customers abandon a chat when the prompts are lengthy. To keep your writing simple
and straightforward, use the Flesch-Kincaid Grade Level feature in Microsoft Word or an
app like Hemingwayapp.com to figure out the grade level of your scripts. In general, the
lower the grade level, the better.

Anticipate mischief

Plan how the bot should respond when users start to play games with it—for example,
asking the same question over and over to test it, using offensive language, or asking
nonsense questions. An appropriate response shows that the bot can be relevant and
helpful, if given a chance. Humor can be effective, but be careful: a humorous response
to an offensive question can backfire.

Be a good listener

      Invite the user into the conversation on a regular basis by asking questions or
      making suggestions.

      Respond to the customer in a timely manner. If the bot is taking a while to process
      the customer's request, use, "I'm thinking" or the typing indicator to let the
      customer know the bot is working on a response.

      Boost the relevance of the bot's responses by making them specific to the context.
      For example, say, "Here's how you change your privacy settings," not "Here's how
      you do that."

Remember whose side you're on

The bot is working on behalf of the customer and is there to serve the customer. It's not
there for Microsoft's benefit.

Watch your pronouns: I, me, my

The bot uses I, me, and my to refer to itself.

When the customer communicates to the bot, they also use I, me, or my. Make sure
those pronouns appear on buttons, links, or other elements of the bot that the user
selects.

Recognize common words

People are familiar with words like help, settings, start over, and stop. Make sure your bot
recognizes and responds to them.
```
