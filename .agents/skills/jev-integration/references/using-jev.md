# Jev usage playbook

This guide gives provider-neutral decision design and current access examples. Jev's capabilities and APIs are evolving; verify live official documentation before relying on endpoint, model, SDK, pricing, limit, or response-schema details.

## 1. What Jev does

Jev is a non-generative decision model. It evaluates text state against typed questions and returns constrained answers with probabilities. It currently accepts text as a string, JSON object, or array of text; it does not process images, audio, or video. It does not write prose, code, explanations, or tool calls.

Use it for bounded semantic work such as classification, routing, triage, policy checks, ranking, moderation, and deciding whether a supplied piece of evidence supports a proposition. A useful test is: could ordinary code answer this exactly without interpreting language? If yes, keep it in code.

## 2. Shape the problem before calling

Separate the pipeline into application-owned stages:

1. Load authoritative inputs and apply deterministic hard rules.
2. Calculate exact facts, counts, dates, or metrics in code.
3. Build a small state containing only relevant facts and text.
4. Ask Jev focused typed questions.
5. Validate the response.
6. Apply application-owned policy and route to action, review, or rejection.
7. Perform side effects through normal application services.

Do not ask Jev to perform arithmetic, count records, check permissions, enforce hard rules, or execute actions. If a wrong judgment has meaningful consequences, keep a human review path and verify the answer against labeled examples before automating.

### State design

- Include only fields each question needs. Structured state is useful when instructions can refer to named fields.
- Calculate values such as totals, dates, eligibility flags, or lookup results in code and include the result as a fact when useful.
- Include the relevant policy and definitions; do not expect Jev to know private business rules.
- Preserve unknown or missing evidence as unknown. Never silently turn missing data into zero, false, or approval.
- Treat user-provided text as untrusted data. Put it in a clearly named field and state in the instructions that it is content to evaluate, not a source of instructions.
- Avoid sending credentials, unnecessary personal data, or unrelated records. Respect provider and organization data policies.

## 3. Pick the question primitive

| Primitive | Ask when | Answer |
|---|---|---|
| Choice | The answer is one of a fixed set of unordered options. | Selected option, a probability for each option, and confidence. |
| Score | The answer lies on a spectrum with levels you can describe. | A score position, a probability for each level, a legend, and confidence. |
| Noul | The question is one clear yes/no proposition. | Noul, the probability that the proposition is true. No separate confidence. |

### Choice

Use Choice for routing, classification, or choosing among known alternatives. Define every option and distinguish neighboring options. Add an “other” or “none of the above” option if the set may not cover every input. Jev supports up to 255 Choice options, but a smaller set is usually easier to interpret.

The selected option is the probability winner; it is not automatically acceptable. If all options may be poor, use a fallback option and, when needed, a separate Noul question such as “Is this option acceptable under the supplied policy?”

### Score

Use Score for one ordered dimension, such as urgency or severity. Supply 2–10 levels in low-to-high order. Describe concrete situations rather than bare numbers or vague labels such as “good,” “medium,” and “bad.” The score is a probability-weighted position and may be fractional. Read it with the level probabilities, legend, and confidence.

Do not combine unrelated attributes into one score. Ask separate Score questions and combine them with code-owned weights when they matter differently.

### Noul

Use Noul for one precisely worded yes/no proposition. Criteria may be omitted, but explicitly explaining what “true” and “false” mean often helps disambiguate near-misses. Its value is the probability of “yes”; it is not a Score and has no separate confidence.

## 4. Write instructions and criteria

- Ask one direct question per primitive. Avoid “analyze everything and decide what to do.”
- Name the state fields the judgment concerns. In instructions, wrap explicit field paths in backticks, for example `ticket.description`.
- Question IDs are labels for your code; they are not sent to Jev. Put the complete meaning in the instructions.
- Give Choice options descriptions that are distinct. If two options are often confused, say what each includes, what belongs in the neighboring option, and give examples.
- Make Score levels concrete, ordered, and mutually understandable. The model does not infer level meaning from the numeric index or from neighboring levels.
- For Noul, define the proposition so that “yes” and “no” are unambiguous. Describe both sides if near-misses matter.
- Keep trusted policy separate from untrusted user content. Never let text being classified change the rules of the classification.
- Version questions and criteria as application logic. A wording change can change behavior and should trigger regression evaluation.

Example question set:

~~~json
{
  "model": "typesafe/jev-1.13",
  "state": {
    "customer_tier": "enterprise",
    "ticket": {
      "subject": "Checkout fails",
      "message": "The page goes blank after I click Pay. I tried two browsers."
    }
  },
  "questions": {
    "team": {
      "type": "choice",
      "instructions": "Which team should handle the issue described in `ticket.message`?",
      "criteria": {
        "payments": "Checkout, billing, or payment processing failures.",
        "frontend": "Rendering, layout, or browser compatibility failures.",
        "account": "Login, permissions, or profile issues.",
        "other": "The issue does not fit the other team descriptions."
      }
    },
    "is_bug": {
      "type": "noul",
      "instructions": "Does `ticket.message` describe broken or unexpected product behavior?",
      "criteria": {
        "true": "A product feature is failing or behaving unexpectedly.",
        "false": "The customer is asking a question or requesting a feature without reporting broken behavior."
      }
    },
    "urgency": {
      "type": "score",
      "instructions": "How urgent is the issue described in `ticket.message`?",
      "criteria": [
        "Can wait for a planned future release.",
        "Should be addressed soon, but a workaround exists.",
        "Blocks a key customer workflow with no reasonable workaround."
      ]
    }
  }
}
~~~

The question set is an example contract, not a universal support policy. Adjust options, definitions, and levels to the application and validate them on its data.

## 5. Batch and sequence questions

Questions in one request are evaluated independently against the same state. Batch independent questions to reduce round trips. For example, ask whether a ticket is a bug, which team owns it, and how urgent it is in one call, then use only the answers needed for the case.

Do not assume one answer conditions another answer in the same request. If a second judgment truly needs the first answer, either:

- make a second request with the first answer added to state; or
- ask the second question speculatively from the original state and have code ignore it unless relevant.

The second option works only when the state contains enough information for that judgment.

## 6. Access Jev

The API surface depends on the provider:

- TypeSafe documentation currently describes the System One API at https://api.typesafe.ai/v1/systemone and its SDK method. Its docs use the jev-latest alias in examples.
- OpenRouter currently documents POST https://openrouter.ai/api/alpha/decisions. Its example model id is typesafe/jev-1.13; the alias ~typesafe/jev-latest tracks its latest version.

Use the provider's current SDK or HTTP reference for the actual credentials, endpoint, model id, request fields, optional metadata, error formats, and response types. Do not mix one provider's model name, key, SDK, or endpoint with another provider's API. Prefer a pinned model version for production comparisons; use an alias only when automatic version movement is intended and monitored.

The OpenRouter HTTP request uses a Bearer API key and JSON body with model, state, and questions. Keep the key in server-side configuration. Do not put it in browser code, public environment variables, a mobile app bundle, or client-side storage.

For example, after saving the JSON question set above as request.json, a Bash shell can send it like this:

~~~bash
curl --request POST \
  --url https://openrouter.ai/api/alpha/decisions \
  --header "Authorization: Bearer $OPENROUTER_API_KEY" \
  --header "Content-Type: application/json" \
  --data @request.json
~~~

Use your provider's SDK or HTTP client and its documented key variable when calling TypeSafe directly.

## 7. Read and validate answers

Answers are returned under the question IDs and include their primitive type. Validate the response against the request before using it: verify every required answer exists, has the requested type, names a known option or level, and contains probabilities in the expected range.

- **Choice probabilities** describe the distribution over all defined options. The chosen option is the highest-probability option. **Confidence** summarizes how concentrated that distribution is. Confidence is not the probability the chosen option is correct.
- **Score probabilities** describe the distribution over defined levels. **Score** is a probability-weighted position along the level indices and can fall between levels. Read the distribution and legend alongside it; different distributions can produce the same score.
- **Noul** is the probability that “yes” is true. A value near 0.5 means the answer is uncertain, not “medium” on a scale.

Jev probabilities are intended to be useful measures of uncertainty, but no individual answer is guaranteed correct. Test calibration and error rates on representative examples from the application domain. Do not compare or combine Choice confidence and Noul as though they were the same field.

Do not expect an explanation field. If a user needs an explanation, show the evidence and rules the application used, or use a separate generative model to draft communication. Do not present an invented explanation as Jev's rationale.

## 8. Turn answers into policy

Keep policy separate from the API request so it can be tested and tuned without paying for another model call. Apply deterministic constraints first; combine answers only according to explicit application-owned rules.

There is no universal action threshold. Choose thresholds based on a labeled sample and the cost of false positives, false negatives, and human review. Evaluate coverage and error rates at candidate thresholds. Route uncertain, conflicting, malformed, or unavailable results to a safe fallback, commonly human review.

For agent tool gating, Jev may provide evidence that an action matches a policy. The application still checks identity, permissions, invariants, and arguments deterministically before executing the tool. Jev never grants authority by itself.

## 9. Evaluate and maintain

Build a labeled set before enabling consequential automation. Include clear positive and negative cases, ambiguous cases, edge cases, missing information, conflicting evidence, rare cases, and text that attempts to manipulate the judgment. Track the expected decision and the relevant rationale from human reviewers.

Measure behavior at action thresholds, not only top-choice accuracy. Depending on the use case, track false-positive and false-negative rates, precision, recall, coverage, review rate, and calibration. Tune thresholds to the cost of mistakes in that domain.

Re-run the evaluation set after changing the model, prompt instructions, criteria, state construction, or policy. Avoid tests that assert exact floating-point values from live inference; test response contracts, routing, thresholds, and behavior on labeled cases.

Use finite timeouts, cancellation, bounded retries for transient failures, and explicit handling for rate limits, authentication errors, insufficient credits, oversized inputs, and invalid responses. Do not retry a client cancellation or an invalid request indefinitely. Do not turn provider failure into a successful decision.

## Official references

- [TypeSafe System One](https://docs.typesafe.ai/concepts/system-one)
- [TypeSafe state](https://docs.typesafe.ai/concepts/state)
- [TypeSafe question primitives](https://docs.typesafe.ai/primitives)
- [Choice](https://docs.typesafe.ai/primitives/choice)
- [Score](https://docs.typesafe.ai/primitives/score)
- [Noul](https://docs.typesafe.ai/primitives/noul)
- [Confidence](https://docs.typesafe.ai/confidence)
- [TypeSafe HTTP API](https://docs.typesafe.ai/api)
- [OpenRouter Decisions API request](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request)
- [OpenRouter Jev model page](https://openrouter.ai/typesafe/jev-1.13/api)
- [OpenRouter: How to use Jev](https://openrouter.ai/blog/tutorials/how-to-use-jev/)
