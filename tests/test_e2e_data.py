JD = {"company": "Globex", "role": "Backend Engineer", "summary": "Python APIs on AWS", "patterns": ["ownership"],
      "keywords": [{"term": "Python", "importance": "required", "category": "hard_skill"},
                   {"term": "REST APIs", "variants": ["RESTful APIs"], "importance": "required", "category": "hard_skill"},
                   {"term": "AWS", "importance": "required", "category": "tool"},
                   {"term": "microservices", "importance": "required", "category": "hard_skill"},
                   {"term": "CI/CD", "importance": "preferred", "category": "tool"},
                   {"term": "Docker", "importance": "preferred", "category": "tool"},
                   {"term": "PostgreSQL", "importance": "preferred", "category": "tool"},
                   {"term": "code review", "importance": "nice", "category": "other"},
                   {"term": "attention to detail", "importance": "preferred", "category": "soft_skill"},
                   {"term": "Kubernetes", "importance": "nice", "category": "tool"}]}
CH = {"overall_assessment": "Solid fit on Python and AWS. Main gaps are explicit API/microservices language and CI/CD; Kubernetes is missing entirely.",
      "suggestions": [{"text": "Add Kubernetes — only if you have real experience with it", "reason": "Listed as nice-to-have; nothing in your resume shows it."},
                      {"text": "Mention PostgreSQL specifically if that's the SQL database you used", "reason": "JD names PostgreSQL; your resume says only 'SQL'."}],
      "changes": [
        {"target_id": "p3", "new_text": "Backend engineer with 4 years of experience designing Python REST APIs and microservices on AWS.", "type": "summary", "reason": "Mirrors the JD's core requirements in the first line recruiters read.", "jd_keywords": ["REST APIs", "microservices"]},
        {"target_id": "p6", "new_text": "Designed and built RESTful APIs in Python and Flask that processed customer orders.", "type": "keyword", "reason": "JD asks for REST API design experience.", "jd_keywords": ["REST APIs"]},
        {"target_id": "p7", "new_text": "Owned AWS deployments through CI/CD pipelines and fixed production bugs, cutting incidents by 30%.", "type": "reword", "reason": "JD stresses ownership and CI/CD.", "jd_keywords": ["CI/CD"]},
        {"target_id": "p8", "new_text": "Led code review for a team of 6 engineers, raising code quality.", "type": "reword", "reason": "JD mentions code review culture.", "jd_keywords": ["code review"]},
      ],
      "notices": [{"text": "The posting asks that applications be written without AI assistance — review every edit and put it in your own words."}],
      "keyword_gaps": [{"term": "Kubernetes", "reason": "Nothing in your resume shows Kubernetes experience, so it wasn't added."},
                       {"term": "PostgreSQL", "reason": "Your resume says SQL but not PostgreSQL specifically — add it only if that's the database you used."}]}
COVER = {"greeting": "Dear Hiring Team,",
         "paragraphs": [
             "Globex's push to scale its order platform on AWS is exactly the kind of backend work I've spent the last four years doing. Your Backend Engineer posting asks for someone who can design Python REST APIs, own what they ship and keep production healthy, and that description reads a lot like my week-to-week work.",
             "At Acme Corp I built services in Python and Flask that handled customer orders end to end, from the request coming in to the record landing in our SQL database. That work maps directly to your need for engineers who design REST APIs in Python, and it taught me to treat reliability, clear error handling and readable code as part of the feature rather than an afterthought that gets bolted on later.",
             "I also own our AWS deployments. After I took them on and started fixing the recurring production bugs, we cut incidents by 30%, which is the kind of ownership your posting calls out. I care about code review too: I regularly help teammates get their changes ready to ship, and I've found that a careful review is one of the cheapest ways to keep incidents from happening in the first place.",
             "I'd welcome the chance to talk about how I could help Globex's backend team ship faster and more safely, and to learn more about the problems the team is tackling this year. Thank you for your time and consideration.",
         ],
         "closing": "Sincerely,", "signature": "Alex Sample",
         "evidence": [
             {"jd_requirement": "Python REST APIs", "resume_evidence": "Built services in Python and Flask that handled customer orders."},
             {"jd_requirement": "AWS / ownership", "resume_evidence": "Worked on AWS deployments and fixed bugs, cutting incidents by 30%."},
             {"jd_requirement": "code review", "resume_evidence": "Helped teammates with code reviews."},
         ]}



# resume-mode mock: a keyword is "supported" if this related word appears in the resume
FAMILY = {"PostgreSQL": "SQL", "microservices": "services", "CI/CD": "deployments", "React": "JSX"}


def keyword_decisions(user_prompt):
    """Canned record_keyword_decisions.
    Notes: adds a keyword whose note has ≥ 8 words, declines the rest.
    Draft-from-resume: adds it if FAMILY[term] appears in the resume, else declines with a follow-up.
    All added skills go into the Skills line in ONE edit; the first noted one also goes into the AWS bullet."""
    import re, json
    notes = re.findall(r'<candidate_note term="([^"]+)"[^>]*>\n(.*?)\n</candidate_note>', user_prompt, re.S)
    drafts = re.findall(r'<draft_from_resume term="([^"]+)"', user_prompt)
    resume = user_prompt.split("Resume paragraphs", 1)[-1].split("The candidate wants", 1)[0]
    decisions, add, noted_add = [], [], []
    for term, note in notes:
        if len(note.split()) >= 8:
            add.append(term); noted_add.append(term)
            decisions.append({"term": term, "decision": "add", "explanation": f"Added {term} to your Skills line."})
        else:
            decisions.append({"term": term, "decision": "decline",
                              "explanation": f"The note says you know {term}, but not what you did with it.",
                              "follow_up_question": f"What did you build or run with {term}, and where?"})
    for term in drafts:
        fam = FAMILY.get(term)
        if fam and fam in resume:
            add.append(term)
            decisions.append({"term": term, "decision": "add", "explanation": f"Your resume mentions {fam}, so I added {term} to your Skills line."})
        else:
            decisions.append({"term": term, "decision": "decline",
                              "explanation": f"Nothing in your resume shows {term} work, so I didn't write it in.",
                              "follow_up_question": f"Where have you used {term}?"})
    cur = dict(re.findall(r'^\[(p\d+)\] \([^)]*\) (".*")$', user_prompt, re.M))
    cur = {k: json.loads(v) for k, v in cur.items()}
    changes = []
    if add:  # build on the current text, like Claude is told to
        changes.append({"target_id": "p10", "new_text": cur["p10"] + ", " + ", ".join(add),
                        "type": "keyword", "reason": "You described hands-on experience with these.", "jd_keywords": add})
        p7 = cur.get("p7", "")
        if noted_add and "Owned AWS deployments" in p7 and "deployments on" not in p7:
            changes.append({"target_id": "p7", "new_text": p7.replace("Owned AWS deployments", f"Owned AWS deployments on {noted_add[0]}", 1),
                            "type": "keyword", "reason": f"Your note ties {noted_add[0]} to this work.", "jd_keywords": [noted_add[0]]})
    return {"decisions": decisions, "changes": changes}
