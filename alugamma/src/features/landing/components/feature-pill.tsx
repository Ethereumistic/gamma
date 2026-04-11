import React from "react";
import { motion } from "motion/react";

interface FeaturePillProps {
  icon: React.ReactNode;
  label: string;
  delay?: number;
}

export function FeaturePill({ icon, label, delay = 0 }: FeaturePillProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay }}
      whileHover={{ y: -2, scale: 1.05 }}
      className="group flex cursor-default items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-5 py-3 text-sm transition-all hover:border-neon-green/40 hover:bg-neon-green/5 hover:shadow-neon-green-sm"
    >
      <span className="text-neon-green transition-transform group-hover:scale-110">
        {React.cloneElement(icon as React.ReactElement, { className: "h-5 w-5" })}
      </span>
      <span className="font-display font-medium text-slate-300 group-hover:text-white">
        {label}
      </span>
    </motion.div>
  );
}
