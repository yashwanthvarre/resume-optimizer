import { motion } from "motion/react";
import { useApp } from "../../store/app";
import { View } from "../../ui/View";
import { AnalyzeBar } from "./AnalyzeBar";
import { FindJobsCard } from "./FindJobsCard";
import { JobCard } from "./JobCard";
import { ResumeCard } from "./ResumeCard";

const item = { hide: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 30 } } };

export function SetupView() {
  const view = useApp((s) => s.view), finderTab = useApp((s) => s.finderTab);
  return (
    <View id="setupView" visible={view === "setup"} className="no-print mx-auto max-w-[640px] px-4 pt-6 pb-10 sm:pt-11">
      <motion.div className="grid gap-4" initial="hide" animate="show" variants={{ show: { transition: { staggerChildren: 0.08 } } }}>
        <motion.div variants={item} className="mb-1.5 grid gap-1.5">
          <h1>Tailor your resume to a job</h1>
          <p className="muted">Add your resume and Claude finds fresh jobs that fit it, or add a job yourself. You'll review every suggested edit before anything is saved.</p>
        </motion.div>
        <motion.div variants={item}><ResumeCard /></motion.div>
        {!finderTab && <motion.div variants={item}><FindJobsCard /></motion.div>}
        <motion.div variants={item}><JobCard /></motion.div>
        <motion.div variants={item}><AnalyzeBar /></motion.div>
      </motion.div>
    </View>
  );
}
