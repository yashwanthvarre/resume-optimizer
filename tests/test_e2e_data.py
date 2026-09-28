JD = {"company": "Globex", "role": "Backend Engineer", "summary": "Python APIs on AWS", "patterns": ["ownership"],
      "keywords": [{"term": "Python", "importance": "required", "category": "hard_skill"},
                   {"term": "REST APIs", "variants": ["RESTful APIs"], "importance": "required", "category": "hard_skill"},
                   {"term": "AWS", "importance": "required", "category": "tool"},
                   {"term": "microservices", "importance": "required", "category": "hard_skill"},
                   {"term": "CI/CD", "importance": "preferred", "category": "tool"},
                   {"term": "Docker", "importance": "preferred", "category": "tool"},
                   {"term": "PostgreSQL", "importance": "preferred", "category": "tool"},
                   {"term": "code review", "importance": "nice", "category": "other"},
                   {"term": "Kubernetes", "importance": "nice", "category": "tool"}]}
CH = {"overall_assessment": "Solid fit on Python and AWS. Main gaps are explicit API/microservices language and CI/CD; Kubernetes is missing entirely.",
      "suggestions": [{"text": "Add Kubernetes — only if you have real experience with it", "reason": "Listed as nice-to-have; nothing in your resume shows it."},
                      {"text": "Mention PostgreSQL specifically if that's the SQL database you used", "reason": "JD names PostgreSQL; your resume says only 'SQL'."}],
      "changes": [
        {"target_id": "p3", "new_text": "Backend engineer with 4 years of experience designing Python REST APIs and microservices on AWS.", "type": "summary", "reason": "Mirrors the JD's core requirements in the first line recruiters read.", "jd_keywords": ["REST APIs", "microservices"]},
        {"target_id": "p6", "new_text": "Designed and built RESTful APIs in Python and Flask that processed customer orders.", "type": "keyword", "reason": "JD asks for REST API design experience.", "jd_keywords": ["REST APIs"]},
        {"target_id": "p7", "new_text": "Owned AWS deployments through CI/CD pipelines and fixed production bugs, cutting incidents by 30%.", "type": "reword", "reason": "JD stresses ownership and CI/CD.", "jd_keywords": ["CI/CD"]},
        {"target_id": "p8", "new_text": "Led code review for a team of 6 engineers, raising code quality.", "type": "reword", "reason": "JD mentions code review culture.", "jd_keywords": ["code review"]},
      ]}
